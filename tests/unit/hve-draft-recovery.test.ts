import assert from "node:assert/strict";
import test from "node:test";
import { recoveryMatchesDraft, type HveDraftRecovery } from "../../app/dashboard/lib/hve-draft-recovery.js";
import { defaultClipEditorState } from "../../app/dashboard/data.js";

const recovery: HveDraftRecovery = {
  schemaVersion: 1,
  clipId: "11111111-1111-4111-8111-111111111111",
  documentHash: "a".repeat(64),
  baseVersion: 3,
  revision: 8,
  state: defaultClipEditorState,
  wordEdits: {},
  hiddenWords: [],
  cutWords: [],
  updatedAt: "2026-08-03T00:00:00.000Z",
};

test("recovery only replays against the exact HVE draft identity", () => {
  assert.equal(recoveryMatchesDraft(recovery, {
    clipId: recovery.clipId, documentHash: recovery.documentHash, baseVersion: 3, revision: 8,
  }), true);
  assert.equal(recoveryMatchesDraft(recovery, {
    clipId: recovery.clipId, documentHash: recovery.documentHash, baseVersion: 4, revision: 0,
  }), false);
  assert.equal(recoveryMatchesDraft(recovery, {
    clipId: recovery.clipId, documentHash: "b".repeat(64), baseVersion: 3, revision: 8,
  }), false);
});
