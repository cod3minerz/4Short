import assert from "node:assert/strict";
import test from "node:test";

import {
  HVE_ACTIVE_WORKER_WINDOW_MS,
  readHveRuntimeFingerprint,
  selectActiveHveRuntimeFingerprint,
} from "../../services/control-api/src/services/hve-runtime-identity.js";

const runtimeA = "a".repeat(64);
const runtimeB = "b".repeat(64);
const now = new Date("2026-08-03T12:00:00.000Z");

function registration(metadata: Record<string, unknown>, ageMs = 1_000) {
  return { metadata, lastHeartbeatAt: new Date(now.getTime() - ageMs) };
}

test("HVE runtime identity normalizes only valid fingerprints", () => {
  assert.equal(readHveRuntimeFingerprint({ runtimeFingerprint: runtimeA.toUpperCase() }), runtimeA);
  assert.equal(readHveRuntimeFingerprint({ runtimeFingerprint: "not-a-runtime" }), null);
  assert.equal(readHveRuntimeFingerprint(null), null);
});

test("HVE runtime scope accepts matching complete active workers", () => {
  const metadata = { runtimeIdentityComplete: true, runtimeFingerprint: runtimeA };
  assert.equal(
    selectActiveHveRuntimeFingerprint([registration(metadata), registration(metadata, 20_000)], now),
    runtimeA,
  );
});

test("HVE runtime scope refuses a mixed active rollout", () => {
  assert.equal(
    selectActiveHveRuntimeFingerprint([
      registration({ runtimeIdentityComplete: true, runtimeFingerprint: runtimeA }),
      registration({ runtimeIdentityComplete: true, runtimeFingerprint: runtimeB }),
    ], now),
    null,
  );
});

test("HVE runtime scope refuses an active worker without a complete identity", () => {
  assert.equal(
    selectActiveHveRuntimeFingerprint([
      registration({ runtimeIdentityComplete: true, runtimeFingerprint: runtimeA }),
      registration({ runtimeIdentityComplete: false, runtimeFingerprint: runtimeB }),
    ], now),
    null,
  );
});

test("HVE runtime scope ignores draining and stale workers", () => {
  assert.equal(
    selectActiveHveRuntimeFingerprint([
      registration({ runtimeIdentityComplete: true, runtimeFingerprint: runtimeA }),
      registration({ runtimeIdentityComplete: true, runtimeFingerprint: runtimeB, draining: true }),
      registration({ runtimeIdentityComplete: false }, HVE_ACTIVE_WORKER_WINDOW_MS + 1),
    ], now),
    runtimeA,
  );
});
