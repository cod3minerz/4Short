import { and, eq, gt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../../../../db/index.js";
import { idempotencyRecords } from "../../../../db/schema.js";
import { getEnv } from "../env.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function requestHash(body: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(body))).digest("hex");
}

export async function runIdempotent<T>(input: {
  db: Database;
  workspaceId: string;
  key: string;
  body: unknown;
  statusCode?: number;
  execute: (tx: Database) => Promise<T>;
}): Promise<{ replayed: boolean; value: T }> {
  const hash = requestHash(input.body);
  return input.db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.key}`}, 0))`);
    const [existing] = await tx.select()
      .from(idempotencyRecords)
      .where(and(
        eq(idempotencyRecords.workspaceId, input.workspaceId),
        eq(idempotencyRecords.key, input.key),
        gt(idempotencyRecords.expiresAt, new Date()),
      ))
      .limit(1);
    if (existing) {
      if (existing.requestHash !== hash) {
        const error = new Error("IDEMPOTENCY_KEY_REUSED");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      return { replayed: true, value: existing.response as T };
    }

    const value = await input.execute(tx);
    await tx.insert(idempotencyRecords).values({
      workspaceId: input.workspaceId,
      key: input.key,
      requestHash: hash,
      statusCode: input.statusCode ?? 200,
      response: value,
      expiresAt: new Date(Date.now() + getEnv().IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000),
    });
    return { replayed: false, value };
  });
}
