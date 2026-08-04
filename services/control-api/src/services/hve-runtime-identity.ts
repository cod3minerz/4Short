/**
 * Runtime identity is the boundary for HVE ETA calibration.
 *
 * A worker sends a fingerprint derived from the immutable image, engine,
 * models, fonts and effective cgroup limits. Completed-job timings only apply
 * to the same identity. During a rolling deploy we deliberately withhold an
 * ETA instead of blending old and new throughput measurements.
 */

export const HVE_ACTIVE_WORKER_WINDOW_MS = 2 * 60_000;

const RUNTIME_FINGERPRINT = /^[a-f0-9]{64}$/i;

type JsonRecord = Record<string, unknown>;

export type HveWorkerRuntimeRegistration = {
  metadata: unknown;
  lastHeartbeatAt: Date;
};

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

/** Reads a well-formed fingerprint from worker metadata or job metrics. */
export function readHveRuntimeFingerprint(value: unknown): string | null {
  const record = asRecord(value);
  const fingerprint = record?.runtimeFingerprint;
  return typeof fingerprint === "string" && RUNTIME_FINGERPRINT.test(fingerprint)
    ? fingerprint.toLowerCase()
    : null;
}

export function hveWorkerIsDraining(metadata: unknown): boolean {
  return asRecord(metadata)?.draining === true;
}

/** A worker without a pinned image identity may run locally, but not calibrate ETA. */
export function hasCompleteHveRuntimeIdentity(metadata: unknown): boolean {
  const record = asRecord(metadata);
  return record?.runtimeIdentityComplete === true && readHveRuntimeFingerprint(metadata) !== null;
}

/**
 * Return the only runtime that may calibrate a user-facing ETA.
 *
 * An active non-draining worker with an incomplete identity is intentionally
 * enough to make the result unknown. Otherwise a just-upgraded worker could
 * be hidden from this calculation and receive an ETA calibrated for a
 * different model, FFmpeg build, or cgroup quota.
 */
export function selectActiveHveRuntimeFingerprint(
  registrations: HveWorkerRuntimeRegistration[],
  now = new Date(),
): string | null {
  const minimumHeartbeat = now.getTime() - HVE_ACTIVE_WORKER_WINDOW_MS;
  const active = registrations.filter((registration) => (
    registration.lastHeartbeatAt.getTime() > minimumHeartbeat
    && !hveWorkerIsDraining(registration.metadata)
  ));

  if (!active.length) return null;

  const fingerprints: string[] = [];
  for (const registration of active) {
    const metadata = asRecord(registration.metadata);
    // A development hash without a pinned image is useful telemetry, but is
    // not safe to use for a customer-facing calibration.
    if (!hasCompleteHveRuntimeIdentity(metadata)) return null;
    const fingerprint = readHveRuntimeFingerprint(metadata)!;
    fingerprints.push(fingerprint);
  }

  const unique = new Set(fingerprints);
  return unique.size === 1 ? fingerprints[0] ?? null : null;
}
