import assert from "node:assert/strict";
import test from "node:test";
import { directLayouts } from "../../packages/contracts/src/index.js";

const base = {
  schemaVersion: 1 as const,
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceHash: "a".repeat(64),
  engineVersion: "hve-0.1",
  generatedAt: "2026-08-03T00:00:00.000Z",
  durationUs: 10_000_000,
  shots: [{ id: "shot-1", range: { startUs: 0, endUs: 10_000_000 }, confidence: 1, reason: "unknown" as const }],
  speakerTurns: [],
  activeSpeakerLinks: [],
  warnings: [],
};

test("director allows a screen layout only when screen and face evidence overlap", () => {
  const plan = directLayouts({
    ...base,
    regions: [
      { id: "screen-1", kind: "screen" as const, range: { startUs: 0, endUs: 10_000_000 }, keyframes: [{ atUs: 0, box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.95 }], confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" } },
      { id: "face-1", kind: "face" as const, range: { startUs: 0, endUs: 10_000_000 }, keyframes: [{ atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 }], confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" } },
    ],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { screen_speaker: 0.9 }, evidence: ["test"] }],
  });
  assert.equal(plan.decisions[0]?.template, "screen_speaker");
  assert.deepEqual(plan.decisions[0]?.regionIds, ["screen-1", "face-1"]);
});

test("director rejects a claimed gameplay layout without verified gameplay and facecam regions", () => {
  const plan = directLayouts({
    ...base,
    regions: [],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { gameplay_facecam: 0.95 }, evidence: ["unverified"] }],
  });
  assert.equal(plan.decisions[0]?.template, "portrait_focus");
  assert.equal(plan.warnings[0]?.code, "HVE_DIRECTOR_REGION_EVIDENCE_MISSING");
});

test("director chooses split and grids only for verified simultaneous face topology", () => {
  const face = (id: string) => ({
    id, kind: "face" as const, range: { startUs: 0, endUs: 10_000_000 },
    keyframes: [{ atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 }],
    confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" },
  });
  const conversation = directLayouts({
    ...base,
    regions: [face("face-1"), face("face-2")],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { conversation: 0.9 }, evidence: ["two_faces"] }],
  });
  assert.equal(conversation.decisions[0]?.template, "split_top_bottom");
  const panel = directLayouts({
    ...base,
    regions: [face("face-1"), face("face-2"), face("face-3"), face("face-4")],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { remote_grid: 0.9 }, evidence: ["four_faces"] }],
  });
  assert.equal(panel.decisions[0]?.template, "grid_4");
});

test("director warns instead of inventing a panel grid from too few face tracks", () => {
  const face = (id: string) => ({
    id, kind: "face" as const, range: { startUs: 0, endUs: 10_000_000 },
    keyframes: [{ atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 }],
    confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" },
  });
  const plan = directLayouts({
    ...base,
    regions: [face("face-1"), face("face-2")],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { panel: 0.9 }, evidence: ["two_faces_only"] }],
  });
  assert.equal(plan.decisions[0]?.template, "portrait_focus");
  assert.equal(plan.warnings[0]?.code, "HVE_DIRECTOR_REGION_EVIDENCE_MISSING");
});

test("director only recommends layouts inside an explicit clip source range", () => {
  const face = (id: string) => ({
    id, kind: "face" as const, range: { startUs: 0, endUs: 10_000_000 },
    keyframes: [{ atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 }],
    confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" },
  });
  const plan = directLayouts({
    ...base,
    regions: [face("face-1"), face("face-2")],
    classifications: [{ range: { startUs: 0, endUs: 10_000_000 }, probabilities: { conversation: 0.9 }, evidence: ["two_faces"] }],
  }, { sourceRange: { startUs: 2_000_000, endUs: 5_000_000 } });
  assert.deepEqual(plan.decisions.map((decision) => decision.range), [{ startUs: 2_000_000, endUs: 5_000_000 }]);
  assert.equal(plan.decisions[0]?.template, "split_top_bottom");
});

test("director holds a verified composite through a short classification blip instead of flickering layouts", () => {
  const plan = directLayouts({
    ...base,
    regions: [
      { id: "screen-1", kind: "screen" as const, range: { startUs: 0, endUs: 10_000_000 }, keyframes: [{ atUs: 0, box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.95 }], confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" } },
      { id: "face-1", kind: "face" as const, range: { startUs: 0, endUs: 10_000_000 }, keyframes: [{ atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 }], confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" } },
    ],
    classifications: [
      { range: { startUs: 0, endUs: 4_000_000 }, probabilities: { screen_speaker: 0.95 }, evidence: ["screen"] },
      { range: { startUs: 4_000_000, endUs: 4_500_000 }, probabilities: { conversation: 0.95 }, evidence: ["brief interruption"] },
      { range: { startUs: 4_500_000, endUs: 10_000_000 }, probabilities: { screen_speaker: 0.95 }, evidence: ["screen"] },
    ],
  });
  assert.deepEqual(plan.decisions.map((decision) => ({ template: decision.template, range: decision.range })), [
    { template: "screen_speaker", range: { startUs: 0, endUs: 10_000_000 } },
  ]);
  assert.ok(plan.decisions[0]?.trace.some((entry) => entry.code === "HVE_DIRECTOR_HYSTERESIS_HOLD"));
});

test("director suppresses an initial short composite claim without a prior verified layout", () => {
  const plan = directLayouts({
    ...base,
    regions: [
      { id: "screen-1", kind: "screen" as const, range: { startUs: 0, endUs: 500_000 }, keyframes: [{ atUs: 0, box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.95 }], confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" } },
      { id: "face-1", kind: "face" as const, range: { startUs: 0, endUs: 500_000 }, keyframes: [{ atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 }], confidence: 0.95, provenance: { detector: "test", modelVersion: "v1" } },
    ],
    classifications: [
      { range: { startUs: 0, endUs: 500_000 }, probabilities: { screen_speaker: 0.95 }, evidence: ["short claim"] },
      { range: { startUs: 500_000, endUs: 10_000_000 }, probabilities: { unknown: 1 }, evidence: ["unknown"] },
    ],
  });
  assert.equal(plan.decisions[0]?.template, "portrait_focus");
  assert.equal(plan.warnings.some((warning) => warning.code === "HVE_DIRECTOR_TRANSIENT_LAYOUT_SUPPRESSED"), true);
});
