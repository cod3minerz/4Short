import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { jobAttempts, jobEvents, jobRequirements, jobs, projectPackages, projects, queueDispatchStates, workerLeases, workspaceQueueStates } from "../../../../db/schema.js";
import {
  applyWorkspaceStreakLimit,
  nextVirtualFinish,
  parseJobRequirements,
  parseWorkerCapability,
  selectRunnableHveCandidate,
  workerCanRunHveJob,
  workerHasCapacity,
  workspaceCanStartJob,
  type HveJobClass,
  type WorkerActiveJobCounts,
} from "./hve-scheduler.js";
import { estimateHveJobDuration, type HveDurationObservation } from "./hve-eta.js";
import { hasCompleteHveRuntimeIdentity, readHveRuntimeFingerprint } from "./hve-runtime-identity.js";

type JobClass = "io" | "provider" | "cpu_light" | "cpu_medium" | "cpu_heavy";

function workerIsDraining(metadata: unknown): boolean {
  return typeof metadata === "object" && metadata !== null
    && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>).draining === true;
}

export function createHveAttemptEtaPrediction(input: {
  job: { type: string; class: HveJobClass; estimatedCost: string | number };
  observations: HveDurationObservation[];
  workerMetadata: unknown;
  predictedAt: Date;
}) {
  const runtimeFingerprint = hasCompleteHveRuntimeIdentity(input.workerMetadata)
    ? readHveRuntimeFingerprint(input.workerMetadata)
    : null;
  const estimate = estimateHveJobDuration({
    type: input.job.type,
    jobClass: input.job.class,
    estimatedCost: Number(input.job.estimatedCost),
  }, input.observations, {
    mode: "exact_runtime",
    runtimeFingerprint,
  });
  // This control-plane record is deliberately fixed at claim time. The
  // worker can append actual measurements later but cannot rewrite what the
  // user-facing ETA was calibrated from.
  return {
    schemaVersion: 1,
    predictedAt: input.predictedAt.toISOString(),
    runtimeFingerprint,
    estimatedCost: Number(input.job.estimatedCost),
    status: estimate.status,
    source: estimate.source,
    sampleSize: estimate.sampleSize,
    p10Seconds: estimate.p10Seconds,
    p50Seconds: estimate.p50Seconds,
    p90Seconds: estimate.p90Seconds,
    ...(estimate.reason ? { reason: estimate.reason } : {}),
  };
}

export async function claimNextJob(input: {
  db: Database;
  workerId: string;
  classes: JobClass[];
  leaseSeconds: number;
}) {
  return input.db.transaction(async (tx) => {
    const [lease] = await tx.select({ capabilities: workerLeases.capabilities, metadata: workerLeases.metadata })
      .from(workerLeases)
      .where(eq(workerLeases.workerId, input.workerId))
      .for("update")
      .limit(1);
    // A drained worker may still heartbeat and remain visible to the admin
    // UI, but it must never receive another job. The local worker loop also
    // refuses claims; this database-side check closes the race for direct or
    // delayed claim requests during maintenance.
    if (workerIsDraining(lease?.metadata)) return null;
    const capability = parseWorkerCapability(lease?.capabilities ?? null);
    // This locks only a single, tiny policy record. Job rows themselves still
    // use SKIP LOCKED, while the streak guard remains global across workers.
    await tx.insert(queueDispatchStates).values({ id: 1 })
      .onConflictDoNothing({ target: queueDispatchStates.id });
    const [dispatchState] = await tx.select()
      .from(queueDispatchStates)
      .where(eq(queueDispatchStates.id, 1))
      .for("update")
      .limit(1);
    const activeOnWorkerRows = await tx.execute(sql`
      select class, count(*)::int as active_count
      from jobs
      where lease_owner = ${input.workerId}
        and status in ('leased', 'waiting_provider')
      group by class
    `);
    const activeOnWorker: WorkerActiveJobCounts = { total: 0, byClass: {} };
    for (const row of activeOnWorkerRows) {
      const jobClass = typeof row.class === "string" ? row.class as HveJobClass : null;
      const count = Number(row.active_count ?? 0);
      if (!jobClass || !Number.isFinite(count) || count < 0) continue;
      activeOnWorker.total += count;
      activeOnWorker.byClass[jobClass] = count;
    }

    const result = await tx.execute(sql`
      with ranked as (
        select
          j.id,
          j.estimated_cost,
          j.queue_weight,
          row_number() over (
            partition by j.workspace_id
            order by j.created_at asc
          ) as workspace_position,
          coalesce(q.virtual_finish, 0)
            - least(extract(epoch from (now() - j.created_at)) / 1800, 0.5)
            as fairness_score
        from jobs j
        left join workspace_queue_states q on q.workspace_id = j.workspace_id
        where j.status = 'queued'
          and j.available_at <= now()
          and j.class in (${sql.join(input.classes.map((value) => sql`${value}`), sql`, `)})
      ),
      candidate as (
        select j.id, j.workspace_id, j.class, r.estimated_cost, r.queue_weight
        from jobs j
        join ranked r on r.id = j.id
        -- One runnable head per workspace makes a series of clip jobs unable
        -- to crowd out other workspace heads. The persistent virtual finish
        -- below supplies proportional service according to plan weight.
        where r.workspace_position = 1
        order by r.fairness_score asc, j.created_at asc
        for update of j skip locked
        limit 32
      )
      select id, workspace_id, class, estimated_cost, queue_weight from candidate
    `);
    const candidateIds = result.map((row) => row.id).filter((value): value is string => typeof value === "string");
    if (!candidateIds.length) return null;

    const requirementsRows = await tx.select().from(jobRequirements)
      .where(inArray(jobRequirements.jobId, candidateIds));
    const requirementsByJob = new Map(requirementsRows.map((row) => [row.jobId, parseJobRequirements(row.requirements)]));
    const workspaceIds = result.map((row) => row.workspace_id).filter((value): value is string => typeof value === "string");
    const activeByWorkspace = new Map<string, number>();
    if (workspaceIds.length) {
      const active = await tx.execute(sql`
        select workspace_id, count(*)::int as active_count
        from jobs
        where workspace_id in (${sql.join(workspaceIds.map((value) => sql`${value}`), sql`, `)})
          and status in ('leased', 'waiting_provider')
        group by workspace_id
      `);
      for (const row of active) {
        if (typeof row.workspace_id === "string") activeByWorkspace.set(row.workspace_id, Number(row.active_count ?? 0));
      }
    }

    const candidates = result.flatMap((row) => (
      typeof row.id === "string" && typeof row.workspace_id === "string" && typeof row.class === "string"
        ? [{ id: row.id, workspaceId: row.workspace_id, jobClass: row.class as JobClass }]
        : []
    ));
    const isRunnable = (queued: typeof candidates[number]) => {
      const requirements = requirementsByJob.get(queued.id) ?? null;
      return workerCanRunHveJob(capability, requirements)
        && workerHasCapacity(capability, activeOnWorker, requirements, queued.jobClass)
        && workspaceCanStartJob(activeByWorkspace.get(queued.workspaceId) ?? 0, requirements);
    };
    const runnableCandidates = candidates.filter(isRunnable);
    // Retain the established selector as a defensive compatibility fallback;
    // SQL has already supplied fair order for the runnable candidates.
    const fallbackCandidate = selectRunnableHveCandidate({
      candidates,
      capability,
      activeOnWorker,
      requirementsByJob,
      activeByWorkspace,
    });
    const candidate = applyWorkspaceStreakLimit(
      runnableCandidates,
      dispatchState?.lastWorkspaceId ?? null,
      dispatchState?.consecutiveClaims ?? 0,
    ) ?? fallbackCandidate;
    const candidateId = candidate?.id;
    if (typeof candidateId !== "string") return null;

    const candidateRow = result.find((row) => row.id === candidateId);
    if (!candidateRow || typeof candidateRow.workspace_id !== "string") return null;
    // Install before lock so concurrent claim transactions serialize their
    // virtual-finish increment. The candidate job itself is already row-locked
    // by the CTE; another worker cannot select its second sibling meanwhile.
    await tx.insert(workspaceQueueStates).values({ workspaceId: candidateRow.workspace_id })
      .onConflictDoNothing({ target: workspaceQueueStates.workspaceId });
    const [queueState] = await tx.select()
      .from(workspaceQueueStates)
      .where(eq(workspaceQueueStates.workspaceId, candidateRow.workspace_id))
      .for("update")
      .limit(1);
    const currentFinish = Number(queueState?.virtualFinish ?? 0);
    const estimatedCost = Math.max(0.1, Number(candidateRow.estimated_cost ?? 1));
    const queueWeight = Math.max(0.1, Number(candidateRow.queue_weight ?? 1));
    const nextFinish = nextVirtualFinish(currentFinish, estimatedCost, queueWeight);
    await tx.update(workspaceQueueStates).set({
      virtualFinish: String(nextFinish),
      updatedAt: new Date(),
    }).where(eq(workspaceQueueStates.workspaceId, candidateRow.workspace_id));
    await tx.update(queueDispatchStates).set({
      lastWorkspaceId: candidateRow.workspace_id,
      consecutiveClaims: dispatchState?.lastWorkspaceId === candidateRow.workspace_id
        ? (dispatchState.consecutiveClaims + 1)
        : 1,
      updatedAt: new Date(),
    }).where(eq(queueDispatchStates.id, 1));

    const [job] = await tx.update(jobs).set({
      status: "leased",
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(Date.now() + input.leaseSeconds * 1000),
      heartbeatAt: new Date(),
      startedAt: sql`coalesce(${jobs.startedAt}, now())`,
      attemptCount: sql`${jobs.attemptCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(jobs.id, candidateId)).returning();

    const observedRows = await tx.select({
      type: jobs.type,
      jobClass: jobs.class,
      estimatedCost: jobs.estimatedCost,
      metrics: jobAttempts.metrics,
    }).from(jobAttempts)
      .innerJoin(jobs, eq(jobs.id, jobAttempts.jobId))
      .where(eq(jobAttempts.status, "succeeded"))
      .orderBy(sql`${jobAttempts.finishedAt} desc`)
      .limit(500);
    const observations: HveDurationObservation[] = observedRows.flatMap((row) => {
      const metrics = row.metrics as Record<string, unknown>;
      const wallSeconds = Number(metrics.wallSeconds);
      const runtimeFingerprint = readHveRuntimeFingerprint(metrics);
      return Number.isFinite(wallSeconds) && wallSeconds > 0
        ? [{
          type: row.type,
          jobClass: row.jobClass as HveJobClass,
          estimatedCost: Number(row.estimatedCost),
          wallSeconds,
          ...(runtimeFingerprint ? { runtimeFingerprint } : {}),
        }]
        : [];
    });
    const etaPrediction = createHveAttemptEtaPrediction({
      job: { type: job.type, class: job.class as HveJobClass, estimatedCost: job.estimatedCost },
      observations,
      workerMetadata: lease?.metadata,
      predictedAt: new Date(),
    });

    await tx.insert(jobAttempts).values({
      jobId: job.id,
      attempt: job.attemptCount,
      workerId: input.workerId,
      status: "running",
      metrics: { hveEtaPrediction: etaPrediction },
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
    const [attempt] = await tx.select({ metrics: jobAttempts.metrics })
      .from(jobAttempts)
      .where(and(eq(jobAttempts.jobId, updated.id), eq(jobAttempts.attempt, updated.attemptCount)))
      .for("update")
      .limit(1);
    // Worker metrics are actual process facts. Preserve the claim-time ETA
    // snapshot from the control plane so coverage cannot be overwritten by a
    // later worker implementation or a retry completion payload.
    const priorMetrics = (attempt?.metrics ?? {}) as Record<string, unknown>;
    const etaPrediction = priorMetrics.hveEtaPrediction;
    await tx.update(jobAttempts)
      .set({
        status: "succeeded",
        metrics: {
          ...priorMetrics,
          ...input.metrics,
          ...(etaPrediction ? { hveEtaPrediction: etaPrediction } : {}),
        },
        finishedAt: new Date(),
      })
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
      -- waiting_provider is reserved for a future asynchronous provider
      -- adapter. It has no producer in the current worker (all calls are
      -- synchronous), but if one is ever introduced it must set a lease
      -- expiry and remain recoverable instead of becoming an immortal row.
      where status in ('leased', 'waiting_provider') and lease_expires_at < now()
      for update skip locked
    `);
    const updatedJobs: Array<typeof jobs.$inferSelect> = [];
    for (const row of expired) {
      if (typeof row.id !== "string") continue;
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, row.id)).limit(1);
      if (!current) continue;
      const retry = current.attemptCount < current.maxAttempts;
      const providerWaitExpired = current.status === "waiting_provider";
      const error = providerWaitExpired
        ? { code: "PROVIDER_WAIT_EXPIRED", message: "Provider wait exceeded its lease deadline" }
        : { code: "LEASE_EXPIRED", message: "Worker heartbeat expired" };
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
        payload: { error, reason: providerWaitExpired ? "provider_wait_expired" : "lease_expired" },
      });
      if (updated.type === "zip_project" && updated.status === "failed") {
        await tx.update(projectPackages).set({
          status: "failed",
          error,
          updatedAt: new Date(),
        }).where(eq(projectPackages.jobId, updated.id));
      }
      // Clip-level render failures must remain local: the project can still
      // deliver all other clips. A pipeline-level lease expiry, on the other
      // hand, has to become visible to the user instead of leaving an
      // infinitely animated "processing" screen.
      if (updated.projectId && !updated.clipId && updated.status === "failed") {
        const message = typeof error.message === "string" ? error.message : "Обработка не завершилась";
        const code = typeof error.code === "string" ? error.code : "LEASE_EXPIRED";
        await tx.update(projects).set({
          status: "failed",
          errorCode: code,
          errorMessage: message,
          updatedAt: new Date(),
        }).where(eq(projects.id, updated.projectId));
      }
      updatedJobs.push(updated);
    }
    return updatedJobs;
  });
}
