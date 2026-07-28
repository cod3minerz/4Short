import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import {
  minuteBuckets,
  minuteReservations,
  minuteTransactions,
  sources,
} from "../../../../db/schema.js";

export async function getMinuteBalance(db: Database, workspaceId: string) {
  const [balance] = await db
    .select({
      availableSeconds: sql<number>`coalesce(sum(${minuteBuckets.availableSeconds}), 0)::bigint`,
      grantedSeconds: sql<number>`coalesce(sum(${minuteBuckets.grantedSeconds}), 0)::bigint`,
    })
    .from(minuteBuckets)
    .where(and(
      eq(minuteBuckets.workspaceId, workspaceId),
      or(isNull(minuteBuckets.expiresAt), gt(minuteBuckets.expiresAt, new Date())),
    ));

  return {
    availableSeconds: Number(balance?.availableSeconds ?? 0),
    grantedSeconds: Number(balance?.grantedSeconds ?? 0),
  };
}

export async function reserveMinutes(input: {
  db: Database;
  workspaceId: string;
  projectId?: string;
  sourceFingerprint: string;
  seconds: number;
  idempotencyKey: string;
}) {
  const alreadyProcessed = await input.db
    .select({ id: sources.id })
    .from(sources)
    .where(and(
      eq(sources.workspaceId, input.workspaceId),
      eq(sources.fingerprint, input.sourceFingerprint),
      sql`${sources.analyzedAt} is not null`,
    ))
    .limit(1);
  if (alreadyProcessed.length) {
    return { alreadyPaid: true, reservationId: null, reservedSeconds: 0 };
  }

  return input.db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(minuteReservations)
      .where(and(
        eq(minuteReservations.workspaceId, input.workspaceId),
        eq(minuteReservations.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    if (existing[0]) {
      return {
        alreadyPaid: false,
        reservationId: existing[0].id,
        reservedSeconds: existing[0].seconds,
      };
    }

    const buckets = await tx
      .select()
      .from(minuteBuckets)
      .where(and(
        eq(minuteBuckets.workspaceId, input.workspaceId),
        gt(minuteBuckets.availableSeconds, 0),
        or(isNull(minuteBuckets.expiresAt), gt(minuteBuckets.expiresAt, new Date())),
      ))
      .orderBy(asc(minuteBuckets.priority), asc(minuteBuckets.expiresAt))
      .for("update");

    const available = buckets.reduce((sum, bucket) => sum + bucket.availableSeconds, 0);
    if (available < input.seconds) {
      const error = new Error("MINUTES_INSUFFICIENT");
      Object.assign(error, { statusCode: 409, availableSeconds: available });
      throw error;
    }

    const [reservation] = await tx
      .insert(minuteReservations)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        sourceFingerprint: input.sourceFingerprint,
        seconds: input.seconds,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning();

    let remaining = input.seconds;
    let balanceAfter = available;
    for (const bucket of buckets) {
      if (!remaining) break;
      const spend = Math.min(remaining, bucket.availableSeconds);
      remaining -= spend;
      balanceAfter -= spend;
      await tx
        .update(minuteBuckets)
        .set({ availableSeconds: bucket.availableSeconds - spend, updatedAt: new Date() })
        .where(eq(minuteBuckets.id, bucket.id));
      await tx.insert(minuteTransactions).values({
        workspaceId: input.workspaceId,
        bucketId: bucket.id,
        reservationId: reservation.id,
        kind: "reserve",
        seconds: -spend,
        balanceAfterSeconds: balanceAfter,
        reason: "source_processing_reservation",
        idempotencyKey: `${input.idempotencyKey}:bucket:${bucket.id}`,
      });
    }

    return {
      alreadyPaid: false,
      reservationId: reservation.id,
      reservedSeconds: input.seconds,
    };
  });
}

export async function releaseReservation(input: {
  db: Database;
  workspaceId: string;
  reservationId: string;
  idempotencyKey: string;
  reason: string;
}) {
  return input.db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(minuteReservations)
      .where(and(
        eq(minuteReservations.id, input.reservationId),
        eq(minuteReservations.workspaceId, input.workspaceId),
      ))
      .for("update")
      .limit(1);
    if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
    if (reservation.status === "released") return reservation;
    if (reservation.status === "committed") throw new Error("RESERVATION_ALREADY_COMMITTED");

    const reserveEntries = await tx
      .select()
      .from(minuteTransactions)
      .where(and(
        eq(minuteTransactions.reservationId, reservation.id),
        eq(minuteTransactions.kind, "reserve"),
      ));

    const current = await getMinuteBalance(tx as unknown as Database, input.workspaceId);
    let balanceAfter = current.availableSeconds;
    for (const entry of reserveEntries) {
      if (!entry.bucketId) continue;
      const seconds = Math.abs(entry.seconds);
      const [bucket] = await tx
        .select()
        .from(minuteBuckets)
        .where(eq(minuteBuckets.id, entry.bucketId))
        .for("update")
        .limit(1);
      if (!bucket) continue;
      balanceAfter += seconds;
      await tx.update(minuteBuckets)
        .set({ availableSeconds: bucket.availableSeconds + seconds, updatedAt: new Date() })
        .where(eq(minuteBuckets.id, bucket.id));
      await tx.insert(minuteTransactions).values({
        workspaceId: input.workspaceId,
        bucketId: bucket.id,
        reservationId: reservation.id,
        kind: "release",
        seconds,
        balanceAfterSeconds: balanceAfter,
        reason: input.reason,
        idempotencyKey: `${input.idempotencyKey}:bucket:${bucket.id}`,
      }).onConflictDoNothing();
    }

    const [updated] = await tx.update(minuteReservations)
      .set({ status: "released", updatedAt: new Date() })
      .where(eq(minuteReservations.id, reservation.id))
      .returning();
    return updated;
  });
}

export async function commitReservation(db: Database, reservationId: string) {
  const [updated] = await db
    .update(minuteReservations)
    .set({ status: "committed", updatedAt: new Date() })
    .where(and(
      eq(minuteReservations.id, reservationId),
      eq(minuteReservations.status, "active"),
    ))
    .returning();
  return updated ?? null;
}
