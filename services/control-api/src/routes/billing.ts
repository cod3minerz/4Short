import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { reserveMinutesSchema } from "../../../../packages/contracts/src/index.js";
import { minutePackages, productPlans } from "../../../../packages/product-config/src/index.js";
import { minuteBuckets, paymentWebhooks, payments } from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { getMinuteBalance, reserveMinutes } from "../services/minutes.js";
import { createYooPayment, getYooPayment } from "../services/yookassa.js";

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
    const provider = await createYooPayment({
      idempotencyKey,
      amountKopecks: item.priceKopecks,
      description: `4Short: пакет ${item.seconds / 60} минут`,
      metadata: { workspaceId, packageCode: item.code },
    });
    const [payment] = await app.db.insert(payments).values({
      workspaceId,
      providerPaymentId: provider.id,
      status: provider.status === "canceled" ? "cancelled" : provider.status,
      amountKopecks: item.priceKopecks,
      paymentMethodId: provider.payment_method?.id,
      idempotencyKey,
      metadata: { packageCode: item.code, seconds: item.seconds },
    }).onConflictDoUpdate({
      target: payments.providerPaymentId,
      set: { status: provider.status === "canceled" ? "cancelled" : provider.status, updatedAt: new Date() },
    }).returning();
    return reply.code(201).send({
      paymentId: payment.id,
      status: payment.status,
      confirmationUrl: provider.confirmation?.confirmation_url,
    });
  });

  app.post("/v1/billing/yookassa/webhook", async (request, reply) => {
    const payload = request.body as {
      type?: string;
      event?: string;
      object?: { id?: string; status?: string };
    };
    const providerPaymentId = payload.object?.id;
    if (!providerPaymentId || !payload.event) throw app.httpErrors.badRequest("Invalid webhook");
    const provider = await getYooPayment(providerPaymentId);
    const [payment] = await app.db.select().from(payments)
      .where(eq(payments.providerPaymentId, provider.id))
      .limit(1);
    if (!payment) return reply.code(200).send({ accepted: true });
    const eventId = `${payload.event}:${provider.id}:${provider.status}`;

    await app.db.transaction(async (tx) => {
      const inserted = await tx.insert(paymentWebhooks).values({
        providerEventId: eventId,
        signatureValid: true,
        payload: payload as Record<string, unknown>,
      }).onConflictDoNothing().returning();
      if (!inserted.length) return;

      const status = provider.status === "canceled" ? "cancelled" : provider.status;
      await tx.update(payments).set({
        status,
        paymentMethodId: provider.payment_method?.id ?? payment.paymentMethodId,
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
        .where(eq(paymentWebhooks.providerEventId, eventId));
    });
    return { accepted: true };
  });
}
