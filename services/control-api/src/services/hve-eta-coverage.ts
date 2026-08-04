/**
 * Evidence evaluator for the claim-time HVE ETA snapshots.
 *
 * We measure only predictions written by the control plane at lease time and
 * only against the identical worker runtime.  This makes a rollout, a model
 * change or a locally started worker incapable of inflating the reported
 * p10–p90 coverage.
 */

const RUNTIME_FINGERPRINT = /^[a-f0-9]{64}$/i;

export type HveEtaPredictionSnapshot = {
  status: "estimated" | "insufficient_evidence";
  runtimeFingerprint: string | null;
  p10Seconds: number | null;
  p50Seconds: number | null;
  p90Seconds: number | null;
};

export type HveEtaCoverageObservation = {
  attemptId: string;
  actualWallSeconds: number;
  prediction: HveEtaPredictionSnapshot;
};

export type HveEtaCoverageResult = {
  status: "pass" | "fail" | "insufficient_evidence";
  runtimeFingerprint: string;
  sampleSize: number;
  excludedCount: number;
  p10P90Coverage: number | null;
  medianAbsolutePercentageError: number | null;
  reason?: "HVE_ETA_COVERAGE_SAMPLE_SIZE_INSUFFICIENT" | "HVE_ETA_COVERAGE_RUNTIME_INVALID";
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Parse only the control-plane claim snapshot retained in attempt metrics. */
export function readHveEtaPredictionSnapshot(value: unknown): HveEtaPredictionSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.status !== "estimated" && record.status !== "insufficient_evidence") return null;
  const nullableNumber = (field: string) => (
    record[field] === null || finitePositive(record[field]) ? record[field] as number | null : undefined
  );
  const p10Seconds = nullableNumber("p10Seconds");
  const p50Seconds = nullableNumber("p50Seconds");
  const p90Seconds = nullableNumber("p90Seconds");
  if (p10Seconds === undefined || p50Seconds === undefined || p90Seconds === undefined) return null;
  // The snapshot is an immutable user-facing interval. Do not accept a
  // malformed order and let a later evaluator silently discard it: that
  // would make bad producer data invisible in operational telemetry.
  if (
    (p10Seconds !== null && p50Seconds !== null && p90Seconds !== null)
    && !(p10Seconds <= p50Seconds && p50Seconds <= p90Seconds)
  ) return null;
  const runtimeFingerprint = record.runtimeFingerprint;
  if (runtimeFingerprint !== null && (typeof runtimeFingerprint !== "string" || !RUNTIME_FINGERPRINT.test(runtimeFingerprint))) return null;
  return {
    status: record.status,
    runtimeFingerprint: typeof runtimeFingerprint === "string" ? runtimeFingerprint.toLowerCase() : null,
    p10Seconds,
    p50Seconds,
    p90Seconds,
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * Evaluate one pinned runtime. Defaults intentionally match the G7 target:
 * fewer than forty actual completions is diagnostic data, not a claim that a
 * user-facing p10–p90 interval is calibrated.
 */
export function evaluateHveEtaCoverage(input: {
  runtimeFingerprint: string;
  observations: HveEtaCoverageObservation[];
  minimumSamples?: number;
  minimumCoverage?: number;
  maximumCoverage?: number;
}): HveEtaCoverageResult {
  const runtimeFingerprint = input.runtimeFingerprint.toLowerCase();
  if (!RUNTIME_FINGERPRINT.test(runtimeFingerprint)) {
    return {
      status: "insufficient_evidence",
      runtimeFingerprint: input.runtimeFingerprint,
      sampleSize: 0,
      excludedCount: input.observations.length,
      p10P90Coverage: null,
      medianAbsolutePercentageError: null,
      reason: "HVE_ETA_COVERAGE_RUNTIME_INVALID",
    };
  }

  const valid = input.observations.filter((observation) => {
    const prediction = observation.prediction;
    return prediction.status === "estimated"
      && prediction.runtimeFingerprint?.toLowerCase() === runtimeFingerprint
      && finitePositive(observation.actualWallSeconds)
      && finitePositive(prediction.p10Seconds)
      && finitePositive(prediction.p50Seconds)
      && finitePositive(prediction.p90Seconds)
      && prediction.p10Seconds <= prediction.p50Seconds
      && prediction.p50Seconds <= prediction.p90Seconds;
  });
  const minimumSamples = input.minimumSamples ?? 40;
  if (valid.length < minimumSamples) {
    return {
      status: "insufficient_evidence",
      runtimeFingerprint,
      sampleSize: valid.length,
      excludedCount: input.observations.length - valid.length,
      p10P90Coverage: null,
      medianAbsolutePercentageError: null,
      reason: "HVE_ETA_COVERAGE_SAMPLE_SIZE_INSUFFICIENT",
    };
  }

  const contained = valid.filter(({ actualWallSeconds, prediction }) => (
    actualWallSeconds >= prediction.p10Seconds! && actualWallSeconds <= prediction.p90Seconds!
  )).length;
  const coverage = contained / valid.length;
  const errors = valid.map(({ actualWallSeconds, prediction }) => (
    Math.abs(prediction.p50Seconds! - actualWallSeconds) / actualWallSeconds
  ));
  const minCoverage = input.minimumCoverage ?? 0.8;
  const maxCoverage = input.maximumCoverage ?? 0.95;
  return {
    status: coverage >= minCoverage && coverage <= maxCoverage ? "pass" : "fail",
    runtimeFingerprint,
    sampleSize: valid.length,
    excludedCount: input.observations.length - valid.length,
    p10P90Coverage: coverage,
    medianAbsolutePercentageError: median(errors),
  };
}
