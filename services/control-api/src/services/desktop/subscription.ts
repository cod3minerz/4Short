import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../../../../../db/index.js";
import {
  minuteBuckets,
  minuteTransactions,
  plans,
  subscriptions,
  workspaces,
} from "../../../../../db/schema.js";
import { productPlans } from "../../../../../packages/product-config/src/index.js";
import { getMinuteBalance } from "../minutes.js";

export type DesktopPlanCode = keyof typeof productPlans;
export const SUBSCRIPTION_DAYS = 30;
const SUBSCRIPTION_BUCKET_PRIORITY = 10;

export const paidPlanCodes = ["start", "creator", "studio"] as const satisfies readonly DesktopPlanCode[];
export const isPaidPlan = (code: string): code is (typeof paidPlanCodes)[number] => (paidPlanCodes as readonly string[]).includes(code);

async function grantBucket(db: Database, input: {
  workspaceId: string;
  source: string;
  seconds: number;
  expiresAt: Date;
  reason: string;
}) {
  await db.transaction(async (tx) => {
    // One grant per (workspace, source) even under concurrent requests.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId + ":" + input.source}))`);
    const [existing] = await tx.select({ id: minuteBuckets.id }).from(minuteBuckets)
      .where(and(eq(minuteBuckets.workspaceId, input.workspaceId), eq(minuteBuckets.source, input.source)))
      .limit(1);
    if (existing) return;
    const [bucket] = await tx.insert(minuteBuckets).values({
      workspaceId: input.workspaceId,
      source: input.source,
      grantedSeconds: input.seconds,
      availableSeconds: input.seconds,
      expiresAt: input.expiresAt,
      priority: SUBSCRIPTION_BUCKET_PRIORITY,
    }).returning();
    const balance = await getMinuteBalance(tx as unknown as Database, input.workspaceId);
    await tx.insert(minuteTransactions).values({
      workspaceId: input.workspaceId,
      bucketId: bucket!.id,
      kind: "grant",
      seconds: input.seconds,
      balanceAfterSeconds: balance.availableSeconds,
      reason: input.reason,
      idempotencyKey: `${input.source}:grant`,
    }).onConflictDoNothing();
  });
}

/** Called from the T-Bank webhook once a subscription payment is confirmed. Idempotent per payment. */
export async function activateSubscription(db: Database, input: {
  workspaceId: string;
  planCode: (typeof paidPlanCodes)[number];
  paymentId: string;
  rebillId?: string | null;
  now?: Date;
}) {
  const plan = productPlans[input.planCode];
  const now = input.now ?? new Date();
  const periodEnd = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
  const source = `subscription:payment:${input.paymentId}`;

  await db.insert(plans).values({
    code: plan.code,
    name: plan.name,
    priceKopecks: plan.priceKopecks,
    includedSeconds: plan.includedSeconds,
    queueWeight: String(plan.queueWeight),
    activeProjects: plan.activeProjects,
    sourceRetentionDays: plan.sourceRetentionDays,
    outputRetentionDays: plan.outputRetentionDays,
    exportHeight: plan.exportHeight,
    watermark: plan.watermark,
  }).onConflictDoNothing();

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId + ":subscription"}))`);
    const [current] = await tx.select().from(subscriptions)
      .where(and(eq(subscriptions.workspaceId, input.workspaceId), eq(subscriptions.status, "active")))
      .orderBy(desc(subscriptions.periodEnd))
      .limit(1);
    if (current && current.planCode === input.planCode && current.providerPaymentMethodId === (input.rebillId ?? current.providerPaymentMethodId)
      && current.periodEnd.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      // Same payment delivered again (or a retried webhook): nothing new to start.
      const [grant] = await tx.select({ id: minuteBuckets.id }).from(minuteBuckets)
        .where(and(eq(minuteBuckets.workspaceId, input.workspaceId), eq(minuteBuckets.source, source))).limit(1);
      if (grant) return;
    }
    if (current) {
      await tx.update(subscriptions).set({ status: "replaced", updatedAt: now }).where(eq(subscriptions.id, current.id));
    }
    await tx.insert(subscriptions).values({
      workspaceId: input.workspaceId,
      planCode: input.planCode,
      status: "active",
      periodStart: now,
      periodEnd,
      providerPaymentMethodId: input.rebillId ?? current?.providerPaymentMethodId ?? null,
    });
    await tx.update(workspaces).set({ planCode: input.planCode, updatedAt: now }).where(eq(workspaces.id, input.workspaceId));
  });

  await grantBucket(db, {
    workspaceId: input.workspaceId,
    source,
    seconds: plan.includedSeconds,
    expiresAt: periodEnd,
    reason: "subscription_period_grant",
  });
}

export async function getActiveSubscription(db: Database, workspaceId: string, now = new Date()) {
  const [row] = await db.select().from(subscriptions)
    .where(and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.status, "active"), gt(subscriptions.periodEnd, now)))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  return row ?? null;
}

/** Free tier: a fresh allowance every calendar month (UTC). Idempotent. */
export async function ensureFreeMonthGrant(db: Database, workspaceId: string, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await grantBucket(db, {
    workspaceId,
    source: `free:${start.toISOString().slice(0, 7)}`,
    seconds: productPlans.free.includedSeconds,
    expiresAt: end,
    reason: "free_month_grant",
  });
}

export async function getLicense(db: Database, workspaceId: string, now = new Date()) {
  const subscription = await getActiveSubscription(db, workspaceId, now);
  const planCode: DesktopPlanCode = subscription && subscription.planCode in productPlans ? (subscription.planCode as DesktopPlanCode) : "free";
  if (planCode === "free") await ensureFreeMonthGrant(db, workspaceId, now);
  const plan = productPlans[planCode];
  const balance = await getMinuteBalance(db, workspaceId);
  return {
    plan: { code: plan.code, name: plan.name, priceKopecks: plan.priceKopecks, includedSeconds: plan.includedSeconds },
    status: subscription ? "active" as const : "free" as const,
    periodEnd: subscription?.periodEnd.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    minutes: balance,
    limits: { exportHeight: plan.exportHeight, watermark: plan.watermark },
    issuedAt: now.toISOString(),
  };
}
