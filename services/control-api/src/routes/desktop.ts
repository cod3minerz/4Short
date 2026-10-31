import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { payments } from "../../../../db/schema.js";
import { mediaLimits, productPlans } from "../../../../packages/product-config/src/index.js";
import { getIdempotencyKey } from "../lib/http.js";
import { runIdempotent } from "../services/idempotency.js";
import { commitReservation, getMinuteBalance, releaseReservation, reserveMinutes } from "../services/minutes.js";
import { findMoments, MomentsError } from "../services/desktop/moments.js";
import { getLicense, isPaidPlan } from "../services/desktop/subscription.js";
import { createTBankPayment, mapTBankStatus } from "../services/tbank.js";

const momentsBody = z.object({
  // sha256 of the source file (computed on the device); keys the minute reservation.
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  durationSeconds: z.number().int().min(1).max(mediaLimits.paid.maxDurationSeconds),
  transcript: z.object({
    segments: z.array(z.object({
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(1),
      text: z.string().max(4_000),
    })).min(1).max(20_000),
  }),
  settings: z.object({
    count: z.number().int().min(1).max(50).optional(),
    durationMinSeconds: z.number().int().min(5).max(120).default(20),
    durationMaxSeconds: z.number().int().min(10).max(180).default(60),
    allowThoughtCompletion: z.boolean().default(true),
    prompt: z.string().max(500).optional(),
  }).refine((value) => value.durationMaxSeconds >= value.durationMinSeconds, "durationMax must be >= durationMin"),
});

const checkoutBody = z.object({ planCode: z.string() });

export async function desktopRoutes(app: FastifyInstance) {
  const authed = { preHandler: app.requireDesktopUser };

  /** Public price list for the subscription screen. */
  app.get("/v1/desktop/plans", async () => ({
    plans: Object.values(productPlans).map((plan) => ({
      code: plan.code,
      name: plan.name,
      priceKopecks: plan.priceKopecks,
      includedSeconds: plan.includedSeconds,
      exportHeight: plan.exportHeight,
      watermark: plan.watermark,
    })),
    periodDays: 30,
  }));

  /** Who is signed in, which plan, how many minutes are left. The desktop app refreshes this on start and after every job. */
  app.get("/v1/desktop/license", authed, async (request) => {
    const { workspaceId, userId } = request.authContext!;
    return { userId, workspaceId, ...(await getLicense(app.db, workspaceId)) };
  });

  app.post("/v1/desktop/moments", {
    ...authed,
    bodyLimit: 8 * 1024 * 1024,
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
  }, async (request) => {
    const parsed = momentsBody.safeParse(request.body);
    if (!parsed.success) throw app.httpErrors.badRequest("Invalid moments request");
    const { workspaceId } = request.authContext!;
    const body = parsed.data;

    const license = await getLicense(app.db, workspaceId);
    const maximum = license.plan.code === "free" ? mediaLimits.free.maxDurationSeconds : mediaLimits.paid.maxDurationSeconds;
    if (body.durationSeconds > maximum) throw app.httpErrors.unprocessableEntity("Video is longer than the plan allows");

    // Same file => same reservation key: searching again for the same video is never charged twice.
    const idempotencyKey = `desktop:moments:${body.sourceFingerprint.toLowerCase()}`;
    let reservation;
    try {
      reservation = await reserveMinutes({
        db: app.db,
        workspaceId,
        sourceFingerprint: body.sourceFingerprint.toLowerCase(),
        seconds: body.durationSeconds,
        idempotencyKey,
      });
    } catch (error) {
      if ((error as Error).message === "MINUTES_INSUFFICIENT") {
        throw app.httpErrors.conflict("Not enough minutes in the subscription");
      }
      throw error;
    }

    try {
      const result = await findMoments(body.transcript.segments, body.settings);
      if (reservation.reservationId) await commitReservation(app.db, reservation.reservationId);
      return {
        candidates: result.candidates,
        minutes: await getMinuteBalance(app.db, workspaceId),
      };
    } catch (error) {
      if (reservation.reservationId) {
        await releaseReservation({
          db: app.db,
          workspaceId,
          reservationId: reservation.reservationId,
          idempotencyKey: `${idempotencyKey}:release`,
          reason: "desktop_moments_failed",
        }).catch((releaseError) => request.log.error({ releaseError }, "failed to release desktop reservation"));
      }
      if (error instanceof MomentsError) {
        request.log.warn({ code: error.code }, "desktop moments failed");
        throw app.httpErrors.createError(error.statusCode, error.message);
      }
      throw error;
    }
  });

  /** Starts a monthly subscription: T-Bank payment with a saved card (RebillId) for renewals. */
  app.post("/v1/desktop/subscription/checkout", authed, async (request, reply) => {
    const parsed = checkoutBody.safeParse(request.body);
    if (!parsed.success || !isPaidPlan(parsed.data.planCode)) throw app.httpErrors.badRequest("Unknown plan");
    const planCode = parsed.data.planCode;
    const plan = productPlans[planCode];
    const idempotencyKey = getIdempotencyKey(request);
    const { workspaceId } = request.authContext!;

    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key: idempotencyKey,
      body: { planCode },
      statusCode: 201,
      execute: async (tx) => {
        const provider = await createTBankPayment({
          idempotencyKey,
          amountKopecks: plan.priceKopecks,
          description: `Narezai: подписка ${plan.name}, 30 дней`,
          workspaceId,
          packageCode: `subscription:${planCode}`,
          recurrent: true,
        });
        if (!provider.PaymentId) throw app.httpErrors.badGateway("T-Bank did not return PaymentId");
        const [payment] = await tx.insert(payments).values({
          workspaceId,
          provider: "tbank",
          providerPaymentId: String(provider.PaymentId),
          status: mapTBankStatus(provider.Status),
          amountKopecks: plan.priceKopecks,
          idempotencyKey,
          metadata: { subscriptionPlan: planCode, seconds: plan.includedSeconds },
        }).onConflictDoUpdate({
          target: [payments.provider, payments.providerPaymentId],
          set: { status: mapTBankStatus(provider.Status), updatedAt: new Date() },
        }).returning();
        return { paymentId: payment!.id, status: payment!.status, confirmationUrl: provider.PaymentURL };
      },
    });
    reply.header("Idempotency-Replayed", String(result.replayed));
    return reply.code(result.replayed ? 200 : 201).send(result.value);
  });

  /** The desktop app polls this after the browser checkout to learn when the payment became a subscription. */
  app.get("/v1/desktop/subscription/payments/:paymentId", authed, async (request) => {
    const { paymentId } = request.params as { paymentId: string };
    const { workspaceId } = request.authContext!;
    const [payment] = await app.db.select({ status: payments.status }).from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.workspaceId, workspaceId))).limit(1);
    if (!payment) throw app.httpErrors.notFound("Payment not found");
    return { status: payment.status };
  });
}
