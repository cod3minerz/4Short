import assert from "node:assert/strict";
import test from "node:test";
import { isProjectJobQueued } from "../../app/dashboard/lib/project-status";

test("queued optional analysis does not override a terminal project state", () => {
  for (const status of ["ready", "partially_ready", "failed", "review_required", "archived"] as const) {
    assert.equal(isProjectJobQueued(status, "queued"), false, status);
    assert.equal(isProjectJobQueued(status, "waiting_provider"), false, status);
  }
});

test("queued processing work remains visible for non-terminal projects", () => {
  assert.equal(isProjectJobQueued("rendering", "queued"), true);
  assert.equal(isProjectJobQueued("transcribing", "waiting_provider"), true);
  assert.equal(isProjectJobQueued("rendering", "succeeded"), false);
});
