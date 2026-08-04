import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHveEtaCoverage, readHveEtaPredictionSnapshot } from "../../services/control-api/src/services/hve-eta-coverage.js";

const runtime = "a".repeat(64);

function observations(actual: number[]) {
  return actual.map((actualWallSeconds, index) => ({
    attemptId: `attempt-${index}`,
    actualWallSeconds,
    prediction: {
      status: "estimated" as const,
      runtimeFingerprint: runtime,
      p10Seconds: 8,
      p50Seconds: 10,
      p90Seconds: 12,
    },
  }));
}

test("HVE ETA coverage needs enough completed predictions from one runtime", () => {
  const result = evaluateHveEtaCoverage({ runtimeFingerprint: runtime, observations: observations([10, 11]), minimumSamples: 3 });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.reason, "HVE_ETA_COVERAGE_SAMPLE_SIZE_INSUFFICIENT");
});

test("HVE ETA coverage evaluates the user-facing p10-p90 interval, not p50-p90", () => {
  const result = evaluateHveEtaCoverage({
    runtimeFingerprint: runtime,
    observations: observations([8, 8, 9, 10, 11, 12, 12, 8, 7, 14]),
    minimumSamples: 10,
  });
  assert.equal(result.status, "pass");
  assert.equal(result.p10P90Coverage, 0.8);
  assert.ok((result.medianAbsolutePercentageError ?? 0) > 0);
});

test("HVE ETA coverage refuses to blend another runtime or malformed prediction", () => {
  const items = observations([10, 10, 10, 10, 13]);
  items.push({
    attemptId: "old-runtime",
    actualWallSeconds: 10,
    prediction: { status: "estimated", runtimeFingerprint: "b".repeat(64), p10Seconds: 1, p50Seconds: 1, p90Seconds: 99 },
  });
  const result = evaluateHveEtaCoverage({ runtimeFingerprint: runtime, observations: items, minimumSamples: 4 });
  assert.equal(result.status, "pass");
  assert.equal(result.sampleSize, 5);
  assert.equal(result.excludedCount, 1);
});

test("HVE ETA coverage fails a falsely narrow or excessively broad calibrated interval", () => {
  const narrow = evaluateHveEtaCoverage({ runtimeFingerprint: runtime, observations: observations([10, 13, 13, 13, 13]), minimumSamples: 5 });
  assert.equal(narrow.status, "fail");
  const broad = evaluateHveEtaCoverage({ runtimeFingerprint: runtime, observations: observations([10, 10, 10, 10, 10]), minimumSamples: 5 });
  assert.equal(broad.status, "fail");
});

test("HVE ETA coverage reads only a well-formed immutable claim snapshot", () => {
  assert.deepEqual(readHveEtaPredictionSnapshot({
    status: "estimated",
    runtimeFingerprint: runtime.toUpperCase(),
    p10Seconds: 8,
    p50Seconds: 10,
    p90Seconds: 12,
  }), {
    status: "estimated",
    runtimeFingerprint: runtime,
    p10Seconds: 8,
    p50Seconds: 10,
    p90Seconds: 12,
  });
  assert.equal(readHveEtaPredictionSnapshot({ status: "estimated", runtimeFingerprint: runtime, p10Seconds: 12, p50Seconds: 10, p90Seconds: 8 }), null);
  assert.equal(readHveEtaPredictionSnapshot({ status: "estimated", runtimeFingerprint: "untrusted", p10Seconds: 8, p50Seconds: 10, p90Seconds: 12 }), null);
});
