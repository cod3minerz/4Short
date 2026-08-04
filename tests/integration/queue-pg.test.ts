import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { closeDb, createDb } from "../../db/index.js";
import { jobAttempts, jobEvents, jobRequirements, jobs, queueDispatchStates, workerLeases, workspaceQueueStates, workspaces } from "../../db/schema.js";
import { claimNextJob, completeJob, requeueExpiredLeases } from "../../services/control-api/src/services/queue.js";
import { resolveHveTestDatabaseUrl } from "../support/hve-test-database.js";

// These tests insert and delete queue rows. They must never use the runtime
// DATABASE_URL by accident: a production connection may be present in a
// developer shell or deploy environment. CI supplies an isolated Postgres
// service explicitly, and an operator must opt in for any other environment.
const databaseUrl = resolveHveTestDatabaseUrl();
const run = Boolean(databaseUrl);

const capability = {
  engineVersion: "hve-queue-integration-1",
  plannerVersion: "planner-1",
  rendererVersion: "renderer-1",
  jobClasses: ["cpu_medium", "cpu_heavy"],
  jobTypes: ["render_clip", "analyze_visual"],
  models: {},
  memoryBytes: 12 * 1024 ** 3,
  scratchFreeBytes: 30 * 1024 ** 3,
  heavySlots: 1,
  mediumSlots: 1,
  maxConcurrentJobs: 2,
};

const heavyRequirements = {
  engineVersion: capability.engineVersion,
  requiredModels: {},
  minimumRamBytes: 1,
  minimumScratchBytes: 1,
  requiredClasses: ["cpu_heavy"],
  requiredJobTypes: ["render_clip"],
  workspaceConcurrencyLimit: 2,
};

const mediumRequirements = {
  ...heavyRequirements,
  requiredClasses: ["cpu_medium"],
  requiredJobTypes: ["analyze_visual"],
};

async function seedWorkspace(db: ReturnType<typeof createDb>, name: string) {
  const [workspace] = await db.insert(workspaces).values({
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`,
  }).returning();
  return workspace!;
}

async function seedWorker(db: ReturnType<typeof createDb>, workerId: string, metadata: Record<string, unknown> = { test: true }) {
  await db.insert(workerLeases).values({
    workerId,
    version: "test",
    capabilities: capability,
    metadata,
  });
}

async function seedJob(input: {
  db: ReturnType<typeof createDb>;
  workspaceId: string;
  idempotencyKey: string;
  jobClass: "cpu_medium" | "cpu_heavy";
  type: "render_clip" | "analyze_visual";
  requirements: Record<string, unknown>;
  status?: "queued" | "leased" | "waiting_provider";
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  queueWeight?: string;
}) {
  const [job] = await input.db.insert(jobs).values({
    workspaceId: input.workspaceId,
    type: input.type,
    class: input.jobClass,
    status: input.status ?? "queued",
    payload: { test: true },
    idempotencyKey: input.idempotencyKey,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: input.leaseExpiresAt,
    heartbeatAt: input.leaseOwner ? new Date() : null,
    attemptCount: input.status === "leased" ? 1 : 0,
    queueWeight: input.queueWeight ?? "1",
  }).returning();
  await input.db.insert(jobRequirements).values({ jobId: job!.id, requirements: input.requirements });
  if (input.status === "leased" && input.leaseOwner) {
    await input.db.insert(jobAttempts).values({
      jobId: job!.id,
      attempt: 1,
      workerId: input.leaseOwner,
      status: "running",
    });
  }
  return job!;
}

async function cleanup(db: ReturnType<typeof createDb>, workspaceIds: string[]) {
  if (!workspaceIds.length) return;
  const jobsForWorkspaces = await db.select({ id: jobs.id }).from(jobs)
    .where(sql`${jobs.workspaceId} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  const jobIds = jobsForWorkspaces.map((job) => job.id);
  if (jobIds.length) {
    await db.delete(jobEvents).where(sql`${jobEvents.jobId} in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
    await db.delete(jobAttempts).where(sql`${jobAttempts.jobId} in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
    await db.delete(jobRequirements).where(sql`${jobRequirements.jobId} in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  await db.delete(jobs).where(sql`${jobs.workspaceId} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  await db.delete(workspaceQueueStates).where(sql`${workspaceQueueStates.workspaceId} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  await db.delete(workspaces).where(sql`${workspaces.id} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
}

test("PostgreSQL claim path respects class slots, concurrency and expired leases", { skip: !run }, async () => {
  const db = createDb(databaseUrl);
  const workerA = `queue-test-a-${randomUUID()}`;
  const workerB = `queue-test-b-${randomUUID()}`;
  const workspaceA = await seedWorkspace(db, "Queue integration A");
  const workspaceB = await seedWorkspace(db, "Queue integration B");
  const workspaceIds = [workspaceA.id, workspaceB.id];

  try {
    await seedWorker(db, workerA);
    await seedWorker(db, workerB);

    // One heavy job already occupies worker A. Its next heavy candidate must
    // not sneak through the global maxConcurrentJobs=2 allowance.
    await seedJob({
      db, workspaceId: workspaceA.id, idempotencyKey: "active-heavy", jobClass: "cpu_heavy", type: "render_clip",
      requirements: heavyRequirements, status: "leased", leaseOwner: workerA,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const blockedHeavy = await seedJob({
      db, workspaceId: workspaceA.id, idempotencyKey: "queued-heavy", jobClass: "cpu_heavy", type: "render_clip",
      requirements: heavyRequirements,
    });
    const runnableMedium = await seedJob({
      db, workspaceId: workspaceB.id, idempotencyKey: "queued-medium", jobClass: "cpu_medium", type: "analyze_visual",
      requirements: mediumRequirements,
    });

    const admitted = await claimNextJob({
      db, workerId: workerA, classes: ["cpu_heavy", "cpu_medium"], leaseSeconds: 60,
    });
    assert.equal(admitted?.id, runnableMedium.id);
    const [heavyAfter] = await db.select().from(jobs).where(eq(jobs.id, blockedHeavy.id));
    assert.equal(heavyAfter?.status, "queued");

    // Only one of two workers may claim the same queued row.
    const contested = await seedJob({
      db, workspaceId: workspaceB.id, idempotencyKey: "contested", jobClass: "cpu_medium", type: "analyze_visual",
      requirements: mediumRequirements,
    });
    const [left, right] = await Promise.all([
      claimNextJob({ db, workerId: workerA, classes: ["cpu_medium"], leaseSeconds: 60 }),
      claimNextJob({ db, workerId: workerB, classes: ["cpu_medium"], leaseSeconds: 60 }),
    ]);
    assert.equal([left?.id, right?.id].filter((id) => id === contested.id).length, 1);

    // An expired attempt becomes retryable exactly once; it no longer has a
    // lease owner and a late worker cannot complete it as the old owner.
    const expired = await seedJob({
      db, workspaceId: workspaceA.id, idempotencyKey: "expired", jobClass: "cpu_medium", type: "analyze_visual",
      requirements: mediumRequirements, status: "leased", leaseOwner: workerB,
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    const requeued = await requeueExpiredLeases(db);
    assert.ok(requeued.some((job) => job.id === expired.id));
    const [expiredAfter] = await db.select().from(jobs).where(eq(jobs.id, expired.id));
    assert.equal(expiredAfter?.status, "queued");
    assert.equal(expiredAfter?.leaseOwner, null);
    assert.equal(expiredAfter?.leaseExpiresAt, null);
    assert.equal(await completeJob({
      db, jobId: expired.id, workerId: workerB, result: { stale: true }, metrics: { wallSeconds: 1 },
    }), null);

    // Provider waits are not produced by the current synchronous worker, but
    // the enum exists for a future async adapter. A failed callback must not
    // create a permanently non-runnable job merely because it is no longer
    // owned by an active worker process.
    const providerWait = await seedJob({
      db, workspaceId: workspaceA.id, idempotencyKey: "provider-wait-expired", jobClass: "cpu_medium", type: "analyze_visual",
      requirements: mediumRequirements, status: "waiting_provider",
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    const providerRecovered = await requeueExpiredLeases(db);
    assert.ok(providerRecovered.some((job) => job.id === providerWait.id));
    const [providerWaitAfter] = await db.select().from(jobs).where(eq(jobs.id, providerWait.id));
    assert.equal(providerWaitAfter?.status, "queued");
    assert.equal((providerWaitAfter?.error as { code?: string } | null)?.code, "PROVIDER_WAIT_EXPIRED");
  } finally {
    await cleanup(db, workspaceIds);
    await db.delete(workerLeases).where(sql`${workerLeases.workerId} in (${workerA}, ${workerB})`);
    await closeDb();
  }
});

test("PostgreSQL claim path applies persistent weighted fairness and a global streak limit", { skip: !run }, async () => {
  const db = createDb(databaseUrl);
  const worker = `queue-fair-worker-${randomUUID()}`;
  const creator = await seedWorkspace(db, "Queue Creator");
  const start = await seedWorkspace(db, "Queue Start");
  const workspaceIds = [creator.id, start.id];
  const order: string[] = [];

  try {
    await db.delete(queueDispatchStates).where(eq(queueDispatchStates.id, 1));
    await seedWorker(db, worker);
    for (let index = 0; index < 12; index += 1) {
      await seedJob({
        db, workspaceId: creator.id, idempotencyKey: `creator-${index}`,
        jobClass: "cpu_medium", type: "analyze_visual", requirements: mediumRequirements, queueWeight: "2",
      });
      await seedJob({
        db, workspaceId: start.id, idempotencyKey: `start-${index}`,
        jobClass: "cpu_medium", type: "analyze_visual", requirements: mediumRequirements, queueWeight: "1",
      });
    }
    for (let index = 0; index < 16; index += 1) {
      const claimed = await claimNextJob({ db, workerId: worker, classes: ["cpu_medium"], leaseSeconds: 60 });
      assert.ok(claimed);
      order.push(claimed!.workspaceId);
      assert.ok(await completeJob({ db, jobId: claimed!.id, workerId: worker, result: { test: true }, metrics: { wallSeconds: 1 } }));
    }
    for (let index = 2; index < order.length; index += 1) {
      assert.notEqual(order[index - 2] === order[index - 1] && order[index - 1] === order[index], true, `workspace monopolized dispatch: ${order.join(",")}`);
    }
    const creatorClaims = order.filter((workspaceId) => workspaceId === creator.id).length;
    const startClaims = order.filter((workspaceId) => workspaceId === start.id).length;
    assert.ok(creatorClaims > startClaims, `weights were ignored: ${creatorClaims}/${startClaims}`);
    assert.ok(startClaims >= 5, `lower-weight workspace starved: ${creatorClaims}/${startClaims}`);
  } finally {
    await cleanup(db, workspaceIds);
    await db.delete(workerLeases).where(eq(workerLeases.workerId, worker));
    await db.delete(queueDispatchStates).where(eq(queueDispatchStates.id, 1));
    await closeDb();
  }
});

test("PostgreSQL claim path does not lease work to a drained worker", { skip: !run }, async () => {
  const db = createDb(databaseUrl);
  const worker = `queue-drained-worker-${randomUUID()}`;
  const workspace = await seedWorkspace(db, "Queue drained worker");
  try {
    await seedWorker(db, worker, { test: true, draining: true });
    await seedJob({
      db,
      workspaceId: workspace.id,
      idempotencyKey: "drained-worker-job",
      jobClass: "cpu_medium",
      type: "analyze_visual",
      requirements: mediumRequirements,
    });
    const claimed = await claimNextJob({ db, workerId: worker, classes: ["cpu_medium"], leaseSeconds: 60 });
    assert.equal(claimed, null);
  } finally {
    await cleanup(db, [workspace.id]);
    await db.delete(workerLeases).where(eq(workerLeases.workerId, worker));
    await closeDb();
  }
});
