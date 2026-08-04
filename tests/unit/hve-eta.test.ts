import assert from "node:assert/strict";
import test from "node:test";
import { estimateHveJobDuration, estimateHveProjectExecution, type HveDurationObservation } from "../../services/control-api/src/services/hve-eta.js";
import { createHveAttemptEtaPrediction } from "../../services/control-api/src/services/queue.js";

const renderSamples: HveDurationObservation[] = [8, 9, 10, 11, 12, 22].map((wallSeconds) => ({
  type: "render_clip",
  jobClass: "cpu_heavy",
  estimatedCost: 2,
  wallSeconds,
}));

test("HVE ETA refuses to estimate with fewer than six exact completed samples", () => {
  const estimate = estimateHveJobDuration({ type: "render_clip", jobClass: "cpu_heavy", estimatedCost: 2 }, renderSamples.slice(0, 5));
  assert.equal(estimate.status, "insufficient_evidence");
  assert.equal(estimate.reason, "HVE_ETA_SAMPLE_SIZE_INSUFFICIENT");
  assert.equal(estimate.p10Seconds, null);
  assert.equal(estimate.p50Seconds, null);
});

test("HVE ETA uses recorded cost-normalized type measurements with p10/p50/p90 quantiles", () => {
  const estimate = estimateHveJobDuration({ type: "render_clip", jobClass: "cpu_heavy", estimatedCost: 4 }, renderSamples);
  assert.equal(estimate.status, "estimated");
  assert.equal(estimate.source, "job_type");
  assert.equal(estimate.sampleSize, 6);
  assert.equal(estimate.p10Seconds, 16);
  assert.equal(estimate.p50Seconds, 20);
  assert.equal(estimate.p90Seconds, 44);
});

test("HVE ETA falls back to resource-class observations only after twelve measurements", () => {
  const samples = Array.from({ length: 12 }, (_, index) => ({
    type: `other-${index}`,
    jobClass: "cpu_medium" as const,
    estimatedCost: 1,
    wallSeconds: 10 + index,
  }));
  const estimate = estimateHveJobDuration({ type: "analyze_visual", jobClass: "cpu_medium", estimatedCost: 2 }, samples);
  assert.equal(estimate.status, "estimated");
  assert.equal(estimate.source, "job_class");
  assert.equal(estimate.p10Seconds, 22);
  assert.equal(estimate.p50Seconds, 30);
  assert.equal(estimate.p90Seconds, 40);
});

test("HVE project ETA never invents a fair-queue wait time", () => {
  const estimate = estimateHveProjectExecution([
    { type: "render_clip", jobClass: "cpu_heavy", estimatedCost: 4 },
  ], renderSamples);
  assert.equal(estimate.status, "estimated");
  assert.equal(estimate.executionP10Seconds, 16);
  assert.equal(estimate.executionP50Seconds, 20);
  assert.equal(estimate.queueP50Seconds, null);
  assert.equal(estimate.queueReason, "HVE_ETA_FAIR_QUEUE_NOT_CALIBRATED");
});

test("HVE ETA rejects a runtime scope when no single active runtime is known", () => {
  const estimate = estimateHveJobDuration(
    { type: "render_clip", jobClass: "cpu_heavy", estimatedCost: 2 },
    renderSamples,
    { mode: "exact_runtime", runtimeFingerprint: null },
  );
  assert.equal(estimate.status, "insufficient_evidence");
  assert.equal(estimate.reason, "HVE_ETA_RUNTIME_UNCERTAIN");
});

test("HVE ETA never combines measurements across worker runtime identities", () => {
  const activeRuntime = "a".repeat(64);
  const retiredRuntime = "b".repeat(64);
  const observations = renderSamples.map((item, index) => ({
    ...item,
    runtimeFingerprint: index < 5 ? activeRuntime : retiredRuntime,
  }));
  const estimate = estimateHveJobDuration(
    { type: "render_clip", jobClass: "cpu_heavy", estimatedCost: 2 },
    observations,
    { mode: "exact_runtime", runtimeFingerprint: activeRuntime },
  );
  assert.equal(estimate.status, "insufficient_evidence");
  assert.equal(estimate.reason, "HVE_ETA_SAMPLE_SIZE_INSUFFICIENT");
  assert.equal(estimate.sampleSize, 5);
});

test("HVE ETA exposes p10-p90 as the coverage range rather than a misleading p50-p90 interval", () => {
  const estimate = estimateHveJobDuration({ type: "render_clip", jobClass: "cpu_heavy", estimatedCost: 2 }, renderSamples);
  assert.equal(estimate.p10Seconds, 8);
  assert.equal(estimate.p50Seconds, 10);
  assert.equal(estimate.p90Seconds, 22);
  assert.ok((estimate.p10Seconds ?? 0) <= (estimate.p50Seconds ?? 0));
  assert.ok((estimate.p50Seconds ?? 0) <= (estimate.p90Seconds ?? 0));
});

test("HVE stores a claim-time ETA snapshot scoped to the claimed worker runtime", () => {
  const activeRuntime = "a".repeat(64);
  const prediction = createHveAttemptEtaPrediction({
    job: { type: "render_clip", class: "cpu_heavy", estimatedCost: 2 },
    observations: Array.from({ length: 6 }, (_, index) => ({
      type: "render_clip",
      jobClass: "cpu_heavy" as const,
      estimatedCost: 1,
      wallSeconds: 10 + index,
      runtimeFingerprint: activeRuntime,
    })),
    workerMetadata: { runtimeIdentityComplete: true, runtimeFingerprint: activeRuntime },
    predictedAt: new Date("2026-08-03T12:00:00.000Z"),
  });
  assert.equal(prediction.status, "estimated");
  assert.equal(prediction.runtimeFingerprint, activeRuntime);
  assert.equal(prediction.p10Seconds, 20);
  assert.equal(prediction.p50Seconds, 24);
  assert.equal(prediction.p90Seconds, 30);

  const incomplete = createHveAttemptEtaPrediction({
    job: { type: "render_clip", class: "cpu_heavy", estimatedCost: 2 },
    observations: [],
    workerMetadata: { runtimeIdentityComplete: false, runtimeFingerprint: activeRuntime },
    predictedAt: new Date("2026-08-03T12:00:00.000Z"),
  });
  assert.equal(incomplete.status, "insufficient_evidence");
  assert.equal(incomplete.reason, "HVE_ETA_RUNTIME_UNCERTAIN");
  assert.equal(incomplete.runtimeFingerprint, null);
});
