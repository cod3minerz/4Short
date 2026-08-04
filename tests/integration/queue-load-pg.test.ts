import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { closeDb, createDb } from "../../db/index.js";
import { jobAttempts, jobEvents, jobRequirements, jobs, queueDispatchStates, workerLeases, workspaceQueueStates, workspaces } from "../../db/schema.js";
import { claimNextJob, completeJob } from "../../services/control-api/src/services/queue.js";
import { resolveHveTestDatabaseUrl } from "../support/hve-test-database.js";

// This is an intentionally destructive load simulation. Keep it physically
// separate from the application connection string so it cannot run against a
// customer database when DATABASE_URL happens to be exported in a shell.
const databaseUrl = resolveHveTestDatabaseUrl();
const run = Boolean(databaseUrl);

// This deliberately models two virtual hours of a 65%-offered-load queue. It
// runs far faster than wall clock: every completed queue admission represents
// thirty seconds of measured worker service. Hardware/ETA evidence still
// belongs to the target-worker benchmark gate; this test proves durable
// PostgreSQL dispatch behaviour under sustained, multi-workspace pressure.
const WORKSPACE_COUNT = 30;
const VIRTUAL_SERVICE_SECONDS = 30;
const VIRTUAL_DURATION_SECONDS = 2 * 60 * 60;
const OFFERED_LOAD = 0.65;
const DISPATCHES = Math.ceil((VIRTUAL_DURATION_SECONDS / VIRTUAL_SERVICE_SECONDS) * OFFERED_LOAD);
const BACKLOG_PER_WORKSPACE = 3;

const capability = {
  engineVersion: "hve-queue-load-1",
  plannerVersion: "planner-1",
  rendererVersion: "renderer-1",
  jobClasses: ["cpu_medium"],
  jobTypes: ["analyze_visual"],
  models: {},
  memoryBytes: 12 * 1024 ** 3,
  scratchFreeBytes: 30 * 1024 ** 3,
  heavySlots: 1,
  mediumSlots: 1,
  maxConcurrentJobs: 1,
};

const requirements = {
  engineVersion: capability.engineVersion,
  requiredModels: {},
  minimumRamBytes: 1,
  minimumScratchBytes: 1,
  requiredClasses: ["cpu_medium"],
  requiredJobTypes: ["analyze_visual"],
  workspaceConcurrencyLimit: 1,
};

type SimWorkspace = {
  id: string;
  queueWeight: number;
  deliveredCost: number;
  claims: number;
  maxClaimGap: number;
  lastClaimAt: number;
  nextSequence: number;
};

function planWeight(index: number): number {
  // Mirrors Free/Start/Creator/Studio's relative service rather than testing
  // a single idealized plan. Every cohort is intentionally non-empty.
  return [1, 1.25, 2, 3][index % 4]!;
}

function jobCost(workspaceIndex: number, sequence: number): number {
  // Deterministic mixed clip complexity: source analysis is not homogenous.
  return [0.5, 1, 1.5, 2, 2.5][(workspaceIndex * 3 + sequence) % 5]!;
}

async function seedJob(input: {
  db: ReturnType<typeof createDb>;
  workspace: SimWorkspace;
  workspaceIndex: number;
}) {
  const cost = jobCost(input.workspaceIndex, input.workspace.nextSequence);
  const [job] = await input.db.insert(jobs).values({
    workspaceId: input.workspace.id,
    type: "analyze_visual",
    class: "cpu_medium",
    status: "queued",
    payload: { loadTest: true, sequence: input.workspace.nextSequence },
    idempotencyKey: `load-${input.workspace.id}-${input.workspace.nextSequence}`,
    estimatedCost: String(cost),
    queueWeight: String(input.workspace.queueWeight),
  }).returning();
  input.workspace.nextSequence += 1;
  await input.db.insert(jobRequirements).values({ jobId: job!.id, requirements });
  return { job: job!, cost };
}

async function cleanup(db: ReturnType<typeof createDb>, workspaceIds: string[]) {
  if (!workspaceIds.length) return;
  const rows = await db.select({ id: jobs.id }).from(jobs)
    .where(sql`${jobs.workspaceId} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  const jobIds = rows.map((row) => row.id);
  if (jobIds.length) {
    await db.delete(jobEvents).where(sql`${jobEvents.jobId} in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
    await db.delete(jobAttempts).where(sql`${jobAttempts.jobId} in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
    await db.delete(jobRequirements).where(sql`${jobRequirements.jobId} in (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  await db.delete(jobs).where(sql`${jobs.workspaceId} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  await db.delete(workspaceQueueStates).where(sql`${workspaceQueueStates.workspaceId} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  await db.delete(workspaces).where(sql`${workspaces.id} in (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
}

test("PostgreSQL weighted queue sustains 30 backlogged workspaces without starvation", { skip: !run }, async () => {
  const db = createDb(databaseUrl);
  const workerId = `queue-load-${randomUUID()}`;
  const simulated: SimWorkspace[] = [];
  const byId = new Map<string, SimWorkspace>();

  try {
    await db.delete(queueDispatchStates).where(eq(queueDispatchStates.id, 1));
    await db.insert(workerLeases).values({
      workerId,
      version: "queue-load-test",
      capabilities: capability,
      metadata: { test: true },
    });

    for (let index = 0; index < WORKSPACE_COUNT; index += 1) {
      const [workspace] = await db.insert(workspaces).values({
        name: `HVE load ${index}`,
        slug: `hve-load-${index}-${randomUUID().slice(0, 8)}`,
      }).returning();
      const state: SimWorkspace = {
        id: workspace!.id,
        queueWeight: planWeight(index),
        deliveredCost: 0,
        claims: 0,
        maxClaimGap: 0,
        lastClaimAt: -1,
        nextSequence: 0,
      };
      simulated.push(state);
      byId.set(state.id, state);
      for (let queued = 0; queued < BACKLOG_PER_WORKSPACE; queued += 1) {
        await seedJob({ db, workspace: state, workspaceIndex: index });
      }
    }

    for (let dispatch = 0; dispatch < DISPATCHES; dispatch += 1) {
      const claimed = await claimNextJob({
        db,
        workerId,
        classes: ["cpu_medium"],
        leaseSeconds: 60,
      });
      assert.ok(claimed, `expected a runnable job at virtual dispatch ${dispatch}`);
      const workspace = byId.get(claimed!.workspaceId);
      assert.ok(workspace, "claimed workspace must belong to this load simulation");
      const cost = Number(claimed!.estimatedCost);
      assert.ok(Number.isFinite(cost) && cost > 0);
      if (workspace!.lastClaimAt >= 0) {
        workspace!.maxClaimGap = Math.max(workspace!.maxClaimGap, dispatch - workspace!.lastClaimAt - 1);
      }
      workspace!.lastClaimAt = dispatch;
      workspace!.claims += 1;
      workspace!.deliveredCost += cost;
      assert.ok(await completeJob({
        db,
        jobId: claimed!.id,
        workerId,
        result: { loadTest: true },
        metrics: { wallSeconds: VIRTUAL_SERVICE_SECONDS },
      }));
      const workspaceIndex = simulated.indexOf(workspace!);
      await seedJob({ db, workspace: workspace!, workspaceIndex });
    }

    const totalDelivered = simulated.reduce((sum, workspace) => sum + workspace.deliveredCost, 0);
    const cohortByWeight = new Map<number, { workspaceWeight: number; deliveredCost: number }>();
    for (const workspace of simulated) {
      assert.ok(workspace.claims > 0, `workspace ${workspace.id} starved completely`);
      // Every workspace remains backlogged. A gap above 90 virtual dispatches
      // means more than 45 minutes with our 30-second service unit and is an
      // operational starvation, independent of its lower entitlement.
      assert.ok(workspace.maxClaimGap <= 90, `workspace ${workspace.id} starved for ${workspace.maxClaimGap} virtual dispatches`);
      const cohort = cohortByWeight.get(workspace.queueWeight) ?? { workspaceWeight: 0, deliveredCost: 0 };
      cohort.workspaceWeight += workspace.queueWeight;
      cohort.deliveredCost += workspace.deliveredCost;
      cohortByWeight.set(workspace.queueWeight, cohort);
    }
    const totalWeight = [...cohortByWeight.values()].reduce((sum, cohort) => sum + cohort.workspaceWeight, 0);
    for (const [weight, cohort] of cohortByWeight) {
      const actualShare = cohort.deliveredCost / totalDelivered;
      const expectedShare = cohort.workspaceWeight / totalWeight;
      const relativeError = Math.abs(actualShare - expectedShare) / expectedShare;
      assert.ok(relativeError <= 0.15, `weighted cohort share drifted ${(relativeError * 100).toFixed(1)}% for weight ${weight}`);
    }
  } finally {
    await cleanup(db, simulated.map((workspace) => workspace.id));
    await db.delete(workerLeases).where(eq(workerLeases.workerId, workerId));
    await db.delete(queueDispatchStates).where(eq(queueDispatchStates.id, 1));
    await closeDb();
  }
});
