import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { jobs } from "../../../../db/schema.js";
import { markAdvancePending, markJobAdvanced } from "./queue.js";
import { advancePipeline } from "./pipeline.js";

const DEFAULT_BATCH_SIZE = 20;

/** Replays durable worker completions whose pipeline advancement was interrupted. */
export async function reconcilePendingPipelineAdvances(
  db: Database,
  options: { limit?: number; onError?: (jobId: string, error: unknown) => void } = {},
) {
  const pending = await db.select().from(jobs)
    .where(and(eq(jobs.status, "succeeded"), eq(jobs.checkpoint, "worker_complete")))
    .orderBy(asc(jobs.completedAt))
    .limit(Math.max(1, Math.floor(options.limit ?? DEFAULT_BATCH_SIZE)));

  let advanced = 0;
  let deferred = 0;
  for (const job of pending) {
    try {
      await advancePipeline(db, job);
      await markJobAdvanced(db, job.id);
      advanced += 1;
    } catch (error) {
      await markAdvancePending(db, job.id, error);
      deferred += 1;
      options.onError?.(job.id, error);
    }
  }
  return { examined: pending.length, advanced, deferred };
}
