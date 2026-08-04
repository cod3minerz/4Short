import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeHve,
  clipDocumentV2Schema,
  engineCapabilitySchema,
  hashHve,
  importClipEdlV1ToDocumentV2,
  jobRequirementsSchema,
  resolvedRenderPlanSchema,
} from "../../packages/contracts/src/index.js";
import { defaultStyleConfig } from "../../packages/product-config/src/index.js";
import {
  applyWorkspaceStreakLimit,
  nextVirtualFinish,
  selectRunnableHveCandidate,
  selectWeightedFairCandidate,
  workerCanRunHveJob,
  workerHasCapacity,
  workspaceCanStartJob,
} from "../../services/control-api/src/services/hve-scheduler.js";

const ids = {
  clip: "11111111-1111-4111-8111-111111111111",
  source: "22222222-2222-4222-8222-222222222222",
  style: "33333333-3333-4333-8333-333333333333",
  analysis: "44444444-4444-4444-8444-444444444444",
};

function v1Edl() {
  return {
    schemaVersion: 1 as const,
    sourceId: ids.source,
    sourceHash: "a".repeat(64),
    range: { startMs: 1_000, endMs: 61_000 },
    cuts: [],
    transcriptEdits: [],
    layout: defaultStyleConfig.layout,
    subtitles: defaultStyleConfig.subtitles,
    silence: defaultStyleConfig.silence,
    export: defaultStyleConfig.export,
    styleVersionId: ids.style,
    rendererVersion: "legacy-1",
  };
}

test("HVE v2 imports a v1 EDL as anchored integer-microsecond document", () => {
  const document = importClipEdlV1ToDocumentV2(v1Edl());
  assert.equal(clipDocumentV2Schema.safeParse(document).success, true);
  assert.equal(document.timebase.ticksPerSecond, 1_000_000);
  assert.deepEqual(document.narrative[0]?.sourceRange, { startUs: 1_000_000, endUs: 61_000_000 });
  assert.equal(document.layout[0]?.anchor.start.kind, "clip_start");
});

test("HVE canonical form sorts object keys but preserves ordered arrays", async () => {
  const left = { z: 1, a: [{ id: "first" }, { id: "second" }] };
  const sameObjectDifferentKeys = { a: [{ id: "first" }, { id: "second" }], z: 1 };
  const reordered = { a: [{ id: "second" }, { id: "first" }], z: 1 };
  assert.equal(canonicalizeHve(left), canonicalizeHve(sameObjectDifferentKeys));
  assert.notEqual(canonicalizeHve(left), canonicalizeHve(reordered));
  assert.equal(await hashHve(left), await hashHve(sameObjectDifferentKeys));
  assert.notEqual(await hashHve(left), await hashHve(reordered));
});

test("resolved plans reject a floating or inverted output time map", () => {
  const result = resolvedRenderPlanSchema.safeParse({
    schemaVersion: 1,
    documentHash: "b".repeat(64),
    canvas: { width: 1080, height: 1920, fps: 30 },
    timeMap: [{
      sourceId: ids.source,
      sourceRange: { startUs: 1_000, endUs: 3_000 },
      outputRange: { startUs: 2_000, endUs: 1_000 },
      rate: { numerator: 1, denominator: 1 },
    }],
    layoutSegments: [],
    captionPlan: { cues: [] },
    fontPlan: {
      id: "hve-sans-v1",
      requestedFamily: "HVE Sans",
      rendererFamily: "DejaVu Sans",
      packVersion: "hve-font-pack-dejavu-2.37-1",
    },
    layerPlan: [],
    audioPlan: { timeMap: [], targetLufs: -14, truePeakDb: -1 },
    warnings: [],
    dependencies: [],
  });
  assert.equal(result.success, false);
});

test("capability admission rejects under-provisioned workers but keeps v1 jobs runnable", () => {
  const capability = engineCapabilitySchema.parse({
    engineVersion: "hve-0.1", plannerVersion: "planner-1", rendererVersion: "render-1",
    jobClasses: ["io", "cpu_light", "cpu_heavy"], models: { stt: "faster-whisper:large-v3-turbo:int8" },
    jobTypes: ["speech_to_text"],
    memoryBytes: 12 * 1024 ** 3, scratchFreeBytes: 30 * 1024 ** 3, heavySlots: 1, mediumSlots: 0, maxConcurrentJobs: 1,
  });
  const requirements = jobRequirementsSchema.parse({
    engineVersion: "hve-0.1", requiredModels: { stt: "faster-whisper:large-v3-turbo:int8" },
    minimumRamBytes: 8 * 1024 ** 3, minimumScratchBytes: 20 * 1024 ** 3,
    requiredClasses: ["cpu_heavy"], requiredJobTypes: ["speech_to_text"], workspaceConcurrencyLimit: 2,
  });
  assert.equal(workerCanRunHveJob(capability, requirements), true);
  assert.equal(workerCanRunHveJob(capability, { ...requirements, requiredClasses: ["cpu_medium"] }), false);
  assert.equal(workerCanRunHveJob(capability, { ...requirements, requiredJobTypes: ["analyze_visual"] }), false);
  assert.equal(workerHasCapacity(capability, 0, requirements), true);
  assert.equal(workerHasCapacity(capability, 1, requirements), false);
  const parallelCapability = { ...capability, maxConcurrentJobs: 2, heavySlots: 1, mediumSlots: 1 };
  assert.equal(workerHasCapacity(parallelCapability, {
    total: 1, byClass: { cpu_heavy: 1 },
  }, requirements, "cpu_heavy"), false);
  assert.equal(workerHasCapacity(parallelCapability, {
    total: 1, byClass: { cpu_heavy: 1 },
  }, { ...requirements, requiredClasses: ["cpu_medium"] }, "cpu_medium"), true);
  assert.equal(workerCanRunHveJob(null, null), true);
  assert.equal(workspaceCanStartJob(1, requirements), true);
  assert.equal(workspaceCanStartJob(2, requirements), false);
});

test("capability candidate selection skips a saturated heavy slot without stalling a compatible queue", () => {
  const capability = engineCapabilitySchema.parse({
    engineVersion: "hve-0.1", plannerVersion: "planner-1", rendererVersion: "render-1",
    jobClasses: ["cpu_medium", "cpu_heavy"], models: {}, jobTypes: ["render_clip"],
    memoryBytes: 12 * 1024 ** 3, scratchFreeBytes: 30 * 1024 ** 3,
    heavySlots: 1, mediumSlots: 1, maxConcurrentJobs: 2,
  });
  const heavy = jobRequirementsSchema.parse({
    engineVersion: "hve-0.1", requiredModels: {}, minimumRamBytes: 1,
    minimumScratchBytes: 1, requiredClasses: ["cpu_heavy"], requiredJobTypes: [], workspaceConcurrencyLimit: 2,
  });
  const medium = jobRequirementsSchema.parse({ ...heavy, requiredClasses: ["cpu_medium"] });
  const selected = selectRunnableHveCandidate({
    candidates: [
      { id: "heavy-next", workspaceId: "workspace-a", jobClass: "cpu_heavy" },
      { id: "medium-next", workspaceId: "workspace-b", jobClass: "cpu_medium" },
    ],
    capability,
    activeOnWorker: { total: 1, byClass: { cpu_heavy: 1 } },
    requirementsByJob: new Map([["heavy-next", heavy], ["medium-next", medium]]),
    activeByWorkspace: new Map(),
  });
  assert.equal(selected?.id, "medium-next");
});

test("weighted fairness gives plans proportional service without starving another workspace", () => {
  const virtualFinish = new Map([["creator", 0], ["start", 0]]);
  const claims = { creator: 0, start: 0 };
  const last: { workspaceId: string | null; count: number } = { workspaceId: null, count: 0 };
  for (let index = 0; index < 120; index += 1) {
    const ordered = [
      { id: `creator-${index}`, workspaceId: "creator", jobClass: "cpu_heavy" as const, estimatedCost: 1, queueWeight: 2, virtualFinish: virtualFinish.get("creator")!, createdAtMs: 0 },
      { id: `start-${index}`, workspaceId: "start", jobClass: "cpu_heavy" as const, estimatedCost: 1, queueWeight: 1, virtualFinish: virtualFinish.get("start")!, createdAtMs: 0 },
    ].sort((left, right) => (left.virtualFinish - right.virtualFinish) || left.id.localeCompare(right.id));
    const selected = applyWorkspaceStreakLimit(ordered, last.workspaceId, last.count)!;
    // The pure scorer agrees with the database-order model before the bounded
    // anti-monopoly guard changes a third consecutive claim.
    assert.ok(selectWeightedFairCandidate(ordered, 0));
    claims[selected.workspaceId as keyof typeof claims] += 1;
    virtualFinish.set(selected.workspaceId, nextVirtualFinish(selected.virtualFinish, selected.estimatedCost, selected.queueWeight));
    last.count = last.workspaceId === selected.workspaceId ? last.count + 1 : 1;
    last.workspaceId = selected.workspaceId;
    assert.ok(last.count <= 2);
  }
  assert.ok(claims.creator > claims.start);
  assert.ok(claims.start >= 40, `low-weight workspace starved: ${claims.start}`);
  assert.ok(claims.creator <= 80, `high-weight workspace monopolized: ${claims.creator}`);
});
