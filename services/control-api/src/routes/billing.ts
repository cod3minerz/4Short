import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { reserveMinutesSchema } from "../../../../packages/contracts/src/index.js";
import { minutePackages, productPlans } from "../../../../packages/product-config/src/index.js";
import { minuteBuckets, paymentWebhooks, payments } from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { runIdempotent } from "../services/idempotency.js";
import { getMinuteBalance, reserveMinutes } from "../services/minutes.js";
import {
  createTBankPayment,
  mapTBankStatus,
  type TBankPayload,
  verifyTBankNotification,
} from "../services/tbank.js";

export async function billingRoutes(app: FastifyInstance) {
  app.get("/v1/billing/summary", { preHandler: app.requireWorkspace }, async (request) => {
    const { workspaceId } = request.authContext!;
    const balance = await getMinuteBalance(app.db, workspaceId);
    return { balance, plans: productPlans, packages: minutePackages };
  });

  app.post("/v1/billing/reservations", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = reserveMinutesSchema.parse(request.body);
    const result = await reserveMinutes({
      db: app.db,
      workspaceId: request.authContext!.workspaceId,
      idempotencyKey: getIdempotencyKey(request),
      ...body,
    });
    return reply.code(result.alreadyPaid ? 200 : 201).send(result);
  });

  app.post("/v1/billing/minute-packages/:code/purchase", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const item = minutePackages.find((candidate) => candidate.code === code);
    if (!item) throw app.httpErrors.notFound("Minute package not found");
    const idempotencyKey = getIdempotencyKey(request);
    const workspaceId = request.authContext!.workspaceId;
    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key: idempotencyKey,
      body: { packageCode: item.code },
      statusCode: 201,
      execute: async (tx) => {
        const provider = await createTBankPayment({
          idempotencyKey,
          amountKopecks: item.priceKopecks,
          description: `4Short: пакет ${item.seconds / 60} минут`,
          workspaceId,
          packageCode: item.code,
        });
        if (!provider.PaymentId) throw app.httpErrors.badGateway("T-Bank did not return PaymentId");
        const providerPaymentId = String(provider.PaymentId);
        const [payment] = await tx.insert(payments).values({
          workspaceId,
          provider: "tbank",
          providerPaymentId,
          status: mapTBankStatus(provider.Status),
          amountKopecks: item.priceKopecks,
          idempotencyKey,
          metadata: { packageCode: item.code, seconds: item.seconds },
        }).onConflictDoUpdate({
          target: [payments.provider, payments.providerPaymentId],
          set: { status: mapTBankStatus(provider.Status), updatedAt: new Date() },
        }).returning();
        return {
          paymentId: payment.id,
          status: payment.status,
          confirmationUrl: provider.PaymentURL,
        };
      },
    });
    reply.header("Idempotency-Replayed", String(result.replayed));
    return reply.code(result.replayed ? 200 : 201).send(result.value);
  });

  app.post("/v1/billing/tbank/webhook", async (request, reply) => {
    const payload = request.body as TBankPayload;
    if (!verifyTBankNotification(payload)) throw app.httpErrors.unauthorized("Invalid T-Bank token");
    const providerPaymentId = payload.PaymentId === undefined ? "" : String(payload.PaymentId);
    const providerStatus = typeof payload.Status === "string" ? payload.Status : undefined;
    if (!providerPaymentId || !providerStatus) throw app.httpErrors.badRequest("Invalid webhook");
    const [payment] = await app.db.select().from(payments)
      .where(and(eq(payments.provider, "tbank"), eq(payments.providerPaymentId, providerPaymentId)))
      .limit(1);
    if (!payment) return reply.type("text/plain").code(200).send("OK");
    const eventId = `${providerPaymentId}:${providerStatus}:${String(payload.ErrorCode ?? "0")}`;

    await app.db.transaction(async (tx) => {
      const inserted = await tx.insert(paymentWebhooks).values({
        provider: "tbank",
        providerEventId: eventId,
        signatureValid: true,
        payload: payload as Record<string, unknown>,
      }).onConflictDoNothing().returning();
      if (!inserted.length) return;

      const status = mapTBankStatus(providerStatus);
      await tx.update(payments).set({
        status,
        paymentMethodId: typeof payload.RebillId === "string" ? payload.RebillId : payment.paymentMethodId,
        updatedAt: new Date(),
      }).where(eq(payments.id, payment.id));

      if (status === "succeeded") {
        const metadata = payment.metadata as { packageCode?: string; seconds?: number };
        const item = minutePackages.find((candidate) => candidate.code === metadata.packageCode);
        if (item) {
          const existing = await tx.select({ id: minuteBuckets.id }).from(minuteBuckets)
            .where(and(
              eq(minuteBuckets.workspaceId, payment.workspaceId),
              eq(minuteBuckets.source, `payment:${payment.id}`),
            ))
            .limit(1);
          if (!existing.length) {
            await tx.insert(minuteBuckets).values({
              workspaceId: payment.workspaceId,
              source: `payment:${payment.id}`,
              grantedSeconds: item.seconds,
              availableSeconds: item.seconds,
              expiresAt: new Date(Date.now() + item.expiresDays * 24 * 60 * 60 * 1000),
              priority: 30,
            });
          }
        }
      }
      await tx.update(paymentWebhooks).set({ processedAt: new Date() })
        .where(and(
          eq(paymentWebhooks.provider, "tbank"),
          eq(paymentWebhooks.providerEventId, eventId),
        ));
    });
    return reply.type("text/plain").send("OK");
  });
}
