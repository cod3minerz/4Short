import assert from "node:assert/strict";
import test from "node:test";
import { offlineBatchMatchesDraft, type HveOfflineCommandBatch } from "../../app/dashboard/lib/hve-offline-command-queue.js";

const identity = {
  clipId: "11111111-1111-4111-8111-111111111111",
  baseVersion: 3,
  revision: 8,
  documentHash: "a".repeat(64),
};

const batch: HveOfflineCommandBatch = {
  schemaVersion: 1,
  batchId: "22222222-2222-4222-8222-222222222222",
  clipId: identity.clipId,
  baseVersion: identity.baseVersion,
  baseRevision: identity.revision,
  documentHash: identity.documentHash,
  commands: [{
    kind: "set_clip_metadata",
    commandId: "33333333-3333-4333-8333-333333333333",
    batchId: "22222222-2222-4222-8222-222222222222",
    clipId: identity.clipId,
    clientId: "test-client",
    clientSequence: 1,
    baseRevision: identity.revision,
    createdAt: "2026-08-03T00:00:00.000Z",
    patch: { title: "Исправленный заголовок" },
  }],
  createdAt: "2026-08-03T00:00:00.000Z",
  lastError: "NETWORK_OR_UNKNOWN_ERROR",
};

test("offline editor batch can replay only into the exact server draft identity", () => {
  assert.equal(offlineBatchMatchesDraft(batch, identity), true);
  assert.equal(offlineBatchMatchesDraft(batch, { ...identity, revision: 9 }), false);
  assert.equal(offlineBatchMatchesDraft(batch, { ...identity, baseVersion: 4 }), false);
  assert.equal(offlineBatchMatchesDraft(batch, { ...identity, documentHash: "b".repeat(64) }), false);
});
