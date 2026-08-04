/**
 * HVE-7 ETA calibration is deliberately evidence-first.  It only turns
 * completed worker measurements into an estimate once there is enough data
 * for the exact job type (or, conservatively, its resource class).  There is
 * no synthetic percentage, no provider promise, and no guessed start time.
 */

export type HveJobClass = "io" | "provider" | "cpu_light" | "cpu_medium" | "cpu_heavy";

export type HveDurationObservation = {
  type: string;
  jobClass: HveJobClass;
  estimatedCost: number;
  wallSeconds: number;
  /** SHA-256 identity emitted by the worker that completed this attempt. */
  runtimeFingerprint?: string;
};

export type HveEtaRuntimeScope =
  | { mode: "unscoped" }
  | { mode: "exact_runtime"; runtimeFingerprint: string | null };

export type HveEtaEstimate = {
  status: "estimated" | "insufficient_evidence";
  source: "job_type" | "job_class" | null;
  sampleSize: number;
  /** Lower bound of the user-facing execution range. */
  p10Seconds: number | null;
  p50Seconds: number | null;
  /** Upper bound of the user-facing execution range. */
  p90Seconds: number | null;
  reason?: "HVE_ETA_SAMPLE_SIZE_INSUFFICIENT" | "HVE_ETA_INVALID_JOB_COST" | "HVE_ETA_RUNTIME_UNCERTAIN";
};

const MIN_TYPE_SAMPLES = 6;
const MIN_CLASS_SAMPLES = 12;
const MAX_ACCEPTED_WALL_SECONDS = 24 * 60 * 60;

function percentile(sorted: number[], percentileValue: number) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index] ?? null;
}

function normalizedRates(observations: HveDurationObservation[]) {
  return observations
    .filter((item) => Number.isFinite(item.estimatedCost) && item.estimatedCost > 0
      && Number.isFinite(item.wallSeconds) && item.wallSeconds > 0 && item.wallSeconds <= MAX_ACCEPTED_WALL_SECONDS)
    .map((item) => item.wallSeconds / item.estimatedCost)
    .sort((left, right) => left - right);
}

function scopedObservations(
  observations: HveDurationObservation[],
  scope: HveEtaRuntimeScope,
): { observations: HveDurationObservation[]; reason?: HveEtaEstimate["reason"] } {
  if (scope.mode === "unscoped") return { observations };
  const fingerprint = scope.runtimeFingerprint;
  if (!fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint)) {
    return { observations: [], reason: "HVE_ETA_RUNTIME_UNCERTAIN" };
  }
  return {
    observations: observations.filter((item) => item.runtimeFingerprint === fingerprint),
  };
}

/** Pure, deterministic estimator used by the API and direct unit tests. */
export function estimateHveJobDuration(
  target: Pick<HveDurationObservation, "type" | "jobClass" | "estimatedCost">,
  observations: HveDurationObservation[],
  scope: HveEtaRuntimeScope = { mode: "unscoped" },
): HveEtaEstimate {
  if (!Number.isFinite(target.estimatedCost) || target.estimatedCost <= 0) {
    return {
      status: "insufficient_evidence",
      source: null,
      sampleSize: 0,
      p10Seconds: null,
      p50Seconds: null,
      p90Seconds: null,
      reason: "HVE_ETA_INVALID_JOB_COST",
    };
  }

  const scoped = scopedObservations(observations, scope);
  if (scoped.reason) {
    return {
      status: "insufficient_evidence",
      source: null,
      sampleSize: 0,
      p10Seconds: null,
      p50Seconds: null,
      p90Seconds: null,
      reason: scoped.reason,
    };
  }

  const byType = normalizedRates(scoped.observations.filter((item) => item.type === target.type));
  const byClass = normalizedRates(scoped.observations.filter((item) => item.jobClass === target.jobClass));
  const source = byType.length >= MIN_TYPE_SAMPLES
    ? { name: "job_type" as const, rates: byType }
    : byClass.length >= MIN_CLASS_SAMPLES
      ? { name: "job_class" as const, rates: byClass }
      : null;
  if (!source) {
    return {
      status: "insufficient_evidence",
      source: null,
      sampleSize: Math.max(byType.length, byClass.length),
      p10Seconds: null,
      p50Seconds: null,
      p90Seconds: null,
      reason: "HVE_ETA_SAMPLE_SIZE_INSUFFICIENT",
    };
  }

  const p10Rate = percentile(source.rates, 0.1);
  const p50Rate = percentile(source.rates, 0.5);
  const p90Rate = percentile(source.rates, 0.9);
  return {
    status: "estimated",
    source: source.name,
    sampleSize: source.rates.length,
    p10Seconds: p10Rate === null ? null : Math.ceil(p10Rate * target.estimatedCost),
    p50Seconds: p50Rate === null ? null : Math.ceil(p50Rate * target.estimatedCost),
    p90Seconds: p90Rate === null ? null : Math.ceil(p90Rate * target.estimatedCost),
  };
}

/**
 * A project can contain jobs from multiple pipeline stages.  We expose
 * independent execution ranges and intentionally omit a queue-start range:
 * weighted fair scheduling means a static queue position would be false
 * precision until a separate queue simulation has benchmark evidence.
 */
export function estimateHveProjectExecution(
  targets: Array<Pick<HveDurationObservation, "type" | "jobClass" | "estimatedCost">>,
  observations: HveDurationObservation[],
  scope: HveEtaRuntimeScope = { mode: "unscoped" },
) {
  const items = targets.map((target) => ({
    type: target.type,
    jobClass: target.jobClass,
    ...estimateHveJobDuration(target, observations, scope),
  }));
  const estimated = items.filter((item) => item.status === "estimated");
  const sufficient = estimated.length === items.length;
  return {
    status: sufficient ? "estimated" as const : "insufficient_evidence" as const,
    executionP50Seconds: sufficient
      ? estimated.reduce((total, item) => total + (item.p50Seconds ?? 0), 0)
      : null,
    // p10–p90 is the displayed execution interval. A p50–p90 interval only
    // covers roughly 40% of a stationary distribution and can never satisfy
    // the HVE-G7 80–95% ETA coverage requirement.
    executionP10Seconds: sufficient
      ? estimated.reduce((total, item) => total + (item.p10Seconds ?? 0), 0)
      : null,
    executionP90Seconds: sufficient
      ? estimated.reduce((total, item) => total + (item.p90Seconds ?? 0), 0)
      : null,
    queueP50Seconds: null,
    queueP90Seconds: null,
    queueReason: "HVE_ETA_FAIR_QUEUE_NOT_CALIBRATED" as const,
    items,
  };
}
