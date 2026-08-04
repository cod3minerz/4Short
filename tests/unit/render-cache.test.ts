import assert from "node:assert/strict";
import test from "node:test";
import { isAdmissibleRenderCacheCandidate } from "../../services/control-api/src/services/render-cache.js";

const now = new Date("2026-08-03T12:00:00.000Z");
const candidate = (overrides: Record<string, unknown> = {}) => ({
  requestedWorkspaceId: "workspace-a",
  mediaWorkspaceId: "workspace-a",
  mediaDeletedAt: null,
  mediaExpiresAt: new Date("2026-08-04T12:00:00.000Z"),
  validation: { valid: true, codec: "h264" },
  ...overrides,
});

test("HVE render cache admits only a validated retained object in the same workspace", () => {
  assert.equal(isAdmissibleRenderCacheCandidate(candidate(), now), true);
});

test("HVE render cache rejects cross-workspace, deleted, expired and unvalidated artifacts", () => {
  assert.equal(isAdmissibleRenderCacheCandidate(candidate({ mediaWorkspaceId: "workspace-b" }), now), false);
  assert.equal(isAdmissibleRenderCacheCandidate(candidate({ mediaDeletedAt: now }), now), false);
  assert.equal(isAdmissibleRenderCacheCandidate(candidate({ mediaExpiresAt: now }), now), false);
  assert.equal(isAdmissibleRenderCacheCandidate(candidate({ validation: { valid: false } }), now), false);
  assert.equal(isAdmissibleRenderCacheCandidate(candidate({ validation: null }), now), false);
});
