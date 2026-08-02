import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { jobAttempts, jobEvents, jobs, workerLeases } from "../../../../db/schema.js";

type JobClass = "io" | "provider" | "cpu_light" | "cpu_heavy";

export async function claimNextJob(input: {
  db: Database;
  workerId: string;
  classes: JobClass[];
  leaseSeconds: number;
}) {
  return input.db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      with ranked as (
        select
          j.id,
          row_number() over (
            partition by j.workspace_id
            order by j.created_at asc
          ) as workspace_position,
          (
            (j.queue_weight::numeric / greatest(j.estimated_cost::numeric, 0.1))
            + least(extract(epoch from (now() - j.created_at)) / 1800, 8)
          ) as fairness_score
        from jobs j
        where j.status = 'queued'
          and j.available_at <= now()
          and j.class in (${sql.join(input.classes.map((value) => sql`${value}`), sql`, `)})
      ),
      candidate as (
        select j.id
        from jobs j
        join ranked r on r.id = j.id
        where r.workspace_position <= 2
        order by r.workspace_position asc, r.fairness_score desc, j.created_at asc
        for update of j skip locked
        limit 1
      )
      select id from candidate
    `);
    const candidateId = result[0]?.id;
    if (typeof candidateId !== "string") return null;

    const [job] = await tx.update(jobs).set({
      status: "leased",
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000),
      heartbeatAt: new Date(),
      startedAt: sql`coalesce(${jobs.startedAt}, now())`,
      attemptCount: sql`${jobs.attemptCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(jobs.id, candidateId)).returning();

    await tx.insert(jobAttempts).values({
      jobId: job.id,
      attempt: job.attemptCount,
      workerId: input.workerId,
      status: "running",
    });
    await tx.insert(jobEvents).values({
      jobId: job.id,
      workspaceId: job.workspaceId,
      type: "job.leased",
      payload: { workerId: input.workerId, attempt: job.attemptCount },
    });
    return job;
  });
}

export async function heartbeatJob(input: {
  db: Database;
  jobId: string;
  workerId: string;
  leaseSeconds: number;
  checkpoint?: string;
  progress?: Record<string, unknown>;
}) {
  const [updated] = await input.db
    .update(jobs)
    .set({
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000),
      checkpoint: input.checkpoint,
      updatedAt: new Date(),
    })
    .where(and(
      eq(jobs.id, input.jobId),
      eq(jobs.status, "leased"),
      eq(jobs.leaseOwner, input.workerId),
    ))
    .returning();
  if (!updated) return null;
  await input.db.update(workerLeases)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(workerLeases.workerId, input.workerId));
  if (input.progress) {
    await input.db.insert(jobEvents).values({
      jobId: updated.id,
      workspaceId: updated.workspaceId,
      type: "job.progress",
      payload: input.progress,
    });
  }
  return updated;
}

export async function completeJob(input: {
  db: Database;
  jobId: string;
  workerId: string;
  result: Record<string, unknown>;
  metrics: Record<string, unknown>;
}) {
  return input.db.transaction(async (tx) => {
    const [updated] = await tx.update(jobs)
      .set({
        status: "succeeded",
        result: input.result,
        checkpoint: "worker_complete",
        completedAt: new Date(),
        leaseExpiresAt: null,
        leaseOwner: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobs.id, input.jobId),
        eq(jobs.status, "leased"),
        eq(jobs.leaseOwner, input.workerId),
      ))
      .returning();
    if (!updated) return null;
    await tx.update(jobAttempts)
      .set({ status: "succeeded", metrics: input.metrics, finishedAt: new Date() })
      .where(and(eq(jobAttempts.jobId, updated.id), eq(jobAttempts.attempt, updated.attemptCount)));
    await tx.insert(jobEvents).values({
      jobId: updated.id,
      workspaceId: updated.workspaceId,
      type: "job.succeeded",
      payload: { result: input.result },
    });
    return updated;
  });
}

export async function markJobAdvanced(db: Database, jobId: string) {
  await db.update(jobs).set({
    checkpoint: "pipeline_advanced",
    error: null,
    updatedAt: new Date(),
  }).where(and(eq(jobs.id, jobId), eq(jobs.status, "succeeded")));
}

export async function markAdvancePending(db: Database, jobId: string, error: unknown) {
  await db.update(jobs).set({
    error: {
      code: "PIPELINE_ADVANCE_PENDING",
      message: error instanceof Error ? error.message : "Unknown pipeline advance error",
    },
    updatedAt: new Date(),
  }).where(and(eq(jobs.id, jobId), eq(jobs.status, "succeeded")));
}

export async function failJob(input: {
  db: Database;
  jobId: string;
  workerId: string;
  retryable: boolean;
  error: Record<string, unknown>;
}) {
  return input.db.transaction(async (tx) => {
    const [current] = await tx.select()
      .from(jobs)
      .where(and(
        eq(jobs.id, input.jobId),
        eq(jobs.status, "leased"),
        eq(jobs.leaseOwner, input.workerId),
      ))
      .for("update")
      .limit(1);
    if (!current) return null;

    const retry = input.retryable && current.attemptCount < current.maxAttempts;
    const delaySeconds = Math.min(15 * 2 ** Math.max(current.attemptCount - 1, 0), 15 * 60);
    const [updated] = await tx.update(jobs)
      .set({
        status: retry ? "queued" : "failed",
        availableAt: retry ? new Date(Date.now() + delaySeconds * 1000) : current.availableAt,
        error: input.error,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: retry ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, current.id))
      .returning();
    await tx.update(jobAttempts)
      .set({ status: retry ? "retrying" : "failed", error: input.error, finishedAt: new Date() })
      .where(and(eq(jobAttempts.jobId, current.id), eq(jobAttempts.attempt, current.attemptCount)));
    await tx.insert(jobEvents).values({
      jobId: current.id,
      workspaceId: current.workspaceId,
      type: retry ? "job.retry_scheduled" : "job.failed",
      payload: { error: input.error, delaySeconds: retry ? delaySeconds : undefined },
    });
    return updated;
  });
}

export async function requeueExpiredLeases(db: Database) {
  return db.transaction(async (tx) => {
    const expired = await tx.execute(sql`
      select id
      from jobs
      where status = 'leased' and lease_expires_at < now()
      for update skip locked
    `);
    const updatedJobs: Array<typeof jobs.$inferSelect> = [];
    for (const row of expired) {
      if (typeof row.id !== "string") continue;
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, row.id)).limit(1);
      if (!current) continue;
      const retry = current.attemptCount < current.maxAttempts;
      const error = { code: "LEASE_EXPIRED", message: "Worker heartbeat expired" };
      const [updated] = await tx.update(jobs).set({
        status: retry ? "queued" : "failed",
        availableAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: retry ? null : new Date(),
        error,
        updatedAt: new Date(),
      }).where(eq(jobs.id, current.id)).returning();
      await tx.update(jobAttempts).set({
        status: retry ? "retrying" : "failed",
        error,
        finishedAt: new Date(),
      }).where(and(
        eq(jobAttempts.jobId, current.id),
        eq(jobAttempts.attempt, current.attemptCount),
      ));
      await tx.insert(jobEvents).values({
        jobId: current.id,
        workspaceId: current.workspaceId,
        type: retry ? "job.retry_scheduled" : "job.failed",
        payload: { error, reason: "lease_expired" },
      });
      updatedJobs.push(updated);
    }
    return updatedJobs;
  });
}
