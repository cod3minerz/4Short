import {
  engineCapabilitySchema,
  jobRequirementsSchema,
  type EngineCapability,
  type JobRequirements,
} from "../../../../packages/contracts/src/index.js";

export type HveJobClass = "io" | "provider" | "cpu_light" | "cpu_medium" | "cpu_heavy";
export type WorkerActiveJobCounts = {
  total: number;
  byClass: Partial<Record<HveJobClass, number>>;
};

export type HveQueuedCandidate = {
  id: string;
  workspaceId: string;
  jobClass: HveJobClass;
};

export type WeightedQueueCandidate = HveQueuedCandidate & {
  estimatedCost: number;
  queueWeight: number;
  virtualFinish: number;
  createdAtMs: number;
};

const MIN_ESTIMATED_COST = 0.1;
const MIN_QUEUE_WEIGHT = 0.1;
const MAX_AGE_CREDIT = 0.5;
const AGE_CREDIT_INTERVAL_MS = 30 * 60 * 1_000;

/**
 * Smaller virtual finish wins.  A bounded age credit makes a delayed low-plan
 * job eligible again but cannot erase unbounded historical service.  The SQL
 * claim query applies the same expression; this function exists so fairness
 * behaviour can be simulated without pretending an in-memory test proves
 * Postgres locks.
 */
export function weightedFairScore(candidate: WeightedQueueCandidate, nowMs: number): number {
  const ageCredit = Math.min(Math.max(0, nowMs - candidate.createdAtMs) / AGE_CREDIT_INTERVAL_MS, MAX_AGE_CREDIT);
  return candidate.virtualFinish - ageCredit;
}

export function nextVirtualFinish(currentVirtualFinish: number, estimatedCost: number, queueWeight: number): number {
  return Number((Math.max(0, currentVirtualFinish) + Math.max(MIN_ESTIMATED_COST, estimatedCost) / Math.max(MIN_QUEUE_WEIGHT, queueWeight)).toFixed(6));
}

export function selectWeightedFairCandidate(candidates: WeightedQueueCandidate[], nowMs: number): WeightedQueueCandidate | null {
  return [...candidates].sort((left, right) => (
    weightedFairScore(left, nowMs) - weightedFairScore(right, nowMs)
    || left.createdAtMs - right.createdAtMs
    || left.id.localeCompare(right.id)
  ))[0] ?? null;
}

/** A bounded anti-monopoly rule applied after SQL fair ordering. */
export function applyWorkspaceStreakLimit<T extends HveQueuedCandidate>(
  candidates: T[],
  lastWorkspaceId: string | null,
  consecutiveClaims: number,
): T | null {
  if (!candidates.length) return null;
  if (lastWorkspaceId && consecutiveClaims >= 2) {
    return candidates.find((candidate) => candidate.workspaceId !== lastWorkspaceId) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}

/**
 * Pure admission check shared by queue tests and the Postgres claim loop.
 * Missing requirements mean a legacy v1 job and deliberately stay runnable.
 */
export function parseWorkerCapability(value: unknown): EngineCapability | null {
  const parsed = engineCapabilitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseJobRequirements(value: unknown): JobRequirements | null {
  const parsed = jobRequirementsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function workerCanRunHveJob(capability: EngineCapability | null, requirements: JobRequirements | null): boolean {
  if (!requirements) return true;
  if (!capability) return false;
  if (requirements.engineVersion && capability.engineVersion !== requirements.engineVersion) return false;
  if (capability.memoryBytes < requirements.minimumRamBytes) return false;
  if (capability.scratchFreeBytes < requirements.minimumScratchBytes) return false;
  if (!requirements.requiredClasses.every((jobClass) => capability.jobClasses.includes(jobClass))) return false;
  if (requirements.requiredClasses.includes("cpu_heavy") && capability.heavySlots < 1) return false;
  if (requirements.requiredClasses.includes("cpu_medium") && capability.mediumSlots < 1) return false;
  if (requirements.requiredJobTypes.length && (!capability.jobTypes || !requirements.requiredJobTypes.every((type) => capability.jobTypes?.includes(type)))) return false;
  return Object.entries(requirements.requiredModels).every(([name, version]) => capability.models[name] === version);
}

/**
 * Admission is separate from compatibility: a matching worker may still be
 * full. Class counts matter once a future worker advertises more than one
 * total slot; checking only total jobs would quietly permit two heavy FFmpeg
 * or STT processes to overlap.
 */
export function workerHasCapacity(
  capability: EngineCapability | null,
  activeJobs: number | WorkerActiveJobCounts,
  requirements: JobRequirements | null,
  requestedClass?: HveJobClass,
): boolean {
  // Legacy jobs retain the existing scheduler semantics while v2 jobs fail
  // closed if the worker did not publish a parseable capacity declaration.
  if (!requirements) return true;
  if (!capability) return false;
  const active = typeof activeJobs === "number"
    ? { total: activeJobs, byClass: {} }
    : activeJobs;
  if (active.total >= capability.maxConcurrentJobs) return false;
  if (requestedClass === "cpu_heavy") return (active.byClass.cpu_heavy ?? 0) < capability.heavySlots;
  if (requestedClass === "cpu_medium") return (active.byClass.cpu_medium ?? 0) < capability.mediumSlots;
  return true;
}

export function workspaceCanStartJob(activeJobs: number, requirements: JobRequirements | null): boolean {
  return !requirements || activeJobs < requirements.workspaceConcurrencyLimit;
}

/**
 * The SQL claim query owns ordering and row locks. This function owns only
 * deterministic capability admission so it can be tested without pretending
 * that an in-memory test proves PostgreSQL locking semantics.
 */
export function selectRunnableHveCandidate(input: {
  candidates: HveQueuedCandidate[];
  capability: EngineCapability | null;
  activeOnWorker: WorkerActiveJobCounts;
  requirementsByJob: ReadonlyMap<string, JobRequirements | null>;
  activeByWorkspace: ReadonlyMap<string, number>;
}): HveQueuedCandidate | null {
  return input.candidates.find((candidate) => {
    const requirements = input.requirementsByJob.get(candidate.id) ?? null;
    return workerCanRunHveJob(input.capability, requirements)
      && workerHasCapacity(input.capability, input.activeOnWorker, requirements, candidate.jobClass)
      && workspaceCanStartJob(input.activeByWorkspace.get(candidate.workspaceId) ?? 0, requirements);
  }) ?? null;
}
