import assert from "node:assert/strict";
import test from "node:test";
import { createProjectSchema, clippingDefaultsSchema } from "../../packages/contracts/src/index.js";
import { initialClipIdentity } from "../../services/control-api/src/services/project-render.js";

const input = {
  title: "Видео", source: { kind: "existing", sourceId: "663bb257-2fc8-4a25-aa2b-d31532daf365" },
  momentSettings: { mode: "best", count: "recommended", durationMinSeconds: 10, durationMaxSeconds: 180 },
  styleVersionId: "763bb257-2fc8-4a25-aa2b-d31532daf365",
};
test("old clients remain review; auto rendering and STT language are explicit contracts", () => {
  assert.equal(createProjectSchema.parse(input).processingMode, "review");
  assert.equal(createProjectSchema.parse(input).speechLanguage, "auto");
  assert.equal(createProjectSchema.parse({ ...input, processingMode: "auto_render", speechLanguage: "ru" }).speechLanguage, "ru");
  assert.equal(createProjectSchema.safeParse({ ...input, processingMode: "mock" }).success, false);
  assert.equal(createProjectSchema.safeParse({ ...input, speechLanguage: "xx" }).success, false);
});
test("initial clip identity is stable per candidate and isolated per project", () => {
  assert.equal(initialClipIdentity("project-a", "candidate-a"), initialClipIdentity("project-a", "candidate-a"));
  assert.notEqual(initialClipIdentity("project-a", "candidate-a"), initialClipIdentity("project-b", "candidate-a"));
  assert.notEqual(initialClipIdentity("project-a", "candidate-a"), initialClipIdentity("project-a", "candidate-b"));
});
test("workspace defaults reject source-specific ranges and unrelated fields", () => {
  const defaults = { momentSettings: input.momentSettings, styleVersionId: input.styleVersionId, speechLanguage: "auto" };
  assert.ok(clippingDefaultsSchema.safeParse(defaults).success);
  assert.ok(!clippingDefaultsSchema.safeParse({ ...defaults, momentSettings: { ...defaults.momentSettings, sourceRange: { startSeconds: 0, endSeconds: 10 } } }).success);
  assert.ok(!clippingDefaultsSchema.safeParse({ ...defaults, source: input.source }).success);
});
