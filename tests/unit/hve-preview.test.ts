import assert from "node:assert/strict";
import test from "node:test";
import { resolveHvePreviewFrame, type ResolvedRenderPlan } from "../../packages/contracts/src/index.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";

function plan(): ResolvedRenderPlan {
  return {
    schemaVersion: 1,
    documentHash: "a".repeat(64),
    canvas: { width: 1080, height: 1920, fps: 30 },
    timeMap: [
      { sourceId, sourceRange: { startUs: 0, endUs: 1_000_000 }, outputRange: { startUs: 0, endUs: 1_000_000 }, rate: { numerator: 1, denominator: 1 } },
      { sourceId, sourceRange: { startUs: 2_000_000, endUs: 3_000_000 }, outputRange: { startUs: 1_000_000, endUs: 2_000_000 }, rate: { numerator: 1, denominator: 1 } },
    ],
    layoutSegments: [{
      outputRange: { startUs: 0, endUs: 2_000_000 },
      slots: [{
        destinationPx: { x: 0, y: 0, width: 1080, height: 1920 },
        source: { analysisId, trackId: "primary-track", kind: "source" },
        fit: "smart_cover",
        cropKeyframes: [
          { atUs: 0, crop: { x: 0.1, y: 0, width: 0.4, height: 1 } },
          { atUs: 999_999, crop: { x: 0.2, y: 0, width: 0.4, height: 1 } },
          { atUs: 1_000_000, crop: { x: 0.5, y: 0, width: 0.4, height: 1 } },
          { atUs: 1_999_999, crop: { x: 0.6, y: 0, width: 0.4, height: 1 } },
        ],
        cornerRadiusPx: 0,
      }],
    }],
    captionPlan: {
      cues: [{
        outputRange: { startUs: 1_200_000, endUs: 1_700_000 },
        lines: ["Точный кадр"],
        activeWordIds: ["word-1"],
        words: [{ wordId: "word-1", text: "Точный", outputRange: { startUs: 1_200_000, endUs: 1_700_000 } }],
      }],
      warnings: [],
    },
    fontPlan: {
      id: "hve-sans-v1",
      requestedFamily: "HVE Sans",
      rendererFamily: "DejaVu Sans",
      packVersion: "hve-font-pack-dejavu-2.37-1",
    },
    layerPlan: [],
    audioPlan: {
      timeMap: [
        { sourceId, sourceRange: { startUs: 0, endUs: 1_000_000 }, outputRange: { startUs: 0, endUs: 1_000_000 }, rate: { numerator: 1, denominator: 1 } },
        { sourceId, sourceRange: { startUs: 2_000_000, endUs: 3_000_000 }, outputRange: { startUs: 1_000_000, endUs: 2_000_000 }, rate: { numerator: 1, denominator: 1 } },
      ],
      targetLufs: -14,
      truePeakDb: -1,
    },
    warnings: [],
    dependencies: [],
  };
}

test("preview follows the same kept-range source clock as the worker", () => {
  const frame = resolveHvePreviewFrame(plan(), 1_500_000);
  assert.ok(frame);
  assert.equal(frame.slots[0]?.sourceTimeUs, 2_500_000);
  assert.equal(frame.captions.length, 1);
  assert.ok(Math.abs((frame.slots[0]?.sourceCrop.x ?? 0) - 0.5500001) < 0.000001);
});

test("preview returns no phantom frame at output end and rejects incomplete crop evidence", () => {
  assert.equal(resolveHvePreviewFrame(plan(), 2_000_000), null);
  const incomplete = plan();
  incomplete.layoutSegments[0]!.slots[0]!.cropKeyframes.pop();
  assert.throws(() => resolveHvePreviewFrame(incomplete, 1_500_000), /HVE_PREVIEW_CROP_COVERAGE_INVALID/);
});

test("preview can select each explicitly active source side of a pause crossfade", () => {
  const crossfadePlan = plan();
  crossfadePlan.timeMap[1] = {
    ...crossfadePlan.timeMap[1]!,
    outputRange: { startUs: 900_000, endUs: 1_900_000 },
    transitionInUs: 100_000,
  };
  crossfadePlan.audioPlan.timeMap = crossfadePlan.timeMap;
  const from = resolveHvePreviewFrame(crossfadePlan, 950_000, { timeMapEntryIndex: 0 });
  const to = resolveHvePreviewFrame(crossfadePlan, 950_000, { timeMapEntryIndex: 1 });
  assert.equal(from?.slots[0]?.sourceTimeUs, 950_000);
  assert.equal(to?.slots[0]?.sourceTimeUs, 2_050_000);
  assert.throws(
    () => resolveHvePreviewFrame(crossfadePlan, 950_000, { timeMapEntryIndex: 7 }),
    /HVE_PREVIEW_SOURCE_MAPPING_UNAVAILABLE/,
  );
});

test("preview projects the exact user-verified gameplay slots from the resolved render plan", () => {
  const composite = plan();
  composite.layoutSegments = [{
    outputRange: { startUs: 0, endUs: 2_000_000 },
    slots: [
      {
        destinationPx: { x: 0, y: 0, width: 1080, height: 576 },
        source: { analysisId, trackId: "source-facecam", kind: "source" },
        fit: "smart_cover",
        cropKeyframes: [
          { atUs: 0, crop: { x: 0.1, y: 0, width: 0.5, height: 1 } },
          { atUs: 999_999, crop: { x: 0.2, y: 0, width: 0.5, height: 1 } },
          { atUs: 1_000_000, crop: { x: 0.3, y: 0, width: 0.5, height: 1 } },
          { atUs: 1_999_999, crop: { x: 0.4, y: 0, width: 0.5, height: 1 } },
        ],
        cornerRadiusPx: 0,
      },
      {
        destinationPx: { x: 0, y: 576, width: 1080, height: 1344 },
        source: { analysisId, trackId: "source-screen", kind: "source" },
        fit: "contain",
        cropKeyframes: [
          { atUs: 0, crop: { x: 0, y: 0.25, width: 1, height: 0.75 } },
          { atUs: 1_999_999, crop: { x: 0, y: 0.25, width: 1, height: 0.75 } },
        ],
        cornerRadiusPx: 0,
      },
    ],
  }];

  const frame = resolveHvePreviewFrame(composite, 1_500_000);
  assert.ok(frame);
  assert.equal(frame.slots.length, 2);
  assert.equal(frame.slots[0]?.sourceTimeUs, 2_500_000);
  assert.deepEqual(frame.slots[0]?.destinationPx, { x: 0, y: 0, width: 1080, height: 576 });
  assert.ok(Math.abs((frame.slots[0]?.sourceCrop.x ?? 0) - 0.3500001) < 0.000001);
  assert.deepEqual(frame.slots[1]?.destinationPx, { x: 0, y: 576, width: 1080, height: 1344 });
  assert.deepEqual(frame.slots[1]?.sourceCrop, { x: 0, y: 0.25, width: 1, height: 0.75 });
});

test("preview projects active B-roll from the immutable plan without inventing audio", () => {
  const brollPlan = plan();
  brollPlan.layerPlan = [{
    layerId: "33333333-3333-4333-8333-333333333333",
    type: "broll",
    outputRange: { startUs: 500_000, endUs: 1_500_000 },
    destinationPx: { x: 0, y: 0, width: 1080, height: 1920 },
    opacity: 1,
    zIndex: 2,
    asset: {
      assetId: "44444444-4444-4444-8444-444444444444",
      kind: "broll",
      sha256: "b".repeat(64),
      mimeType: "video/mp4",
      byteSize: 1_024,
      durationMs: 1_000,
      profile: "hve-timed-visual-h264-aac-v1",
      audioPolicy: "muted_until_timed_audio_is_implemented",
    },
    muted: true,
    visualPolicy: "replace_full_canvas_keep_narrative_audio",
    fit: "cover",
  }];

  assert.deepEqual(resolveHvePreviewFrame(brollPlan, 499_999)?.layers, []);
  const active = resolveHvePreviewFrame(brollPlan, 1_000_000);
  assert.ok(active);
  assert.deepEqual(active.layers, [{
    layerId: "33333333-3333-4333-8333-333333333333",
    type: "broll",
    destinationPx: { x: 0, y: 0, width: 1080, height: 1920 },
    opacity: 1,
    zIndex: 2,
    assetId: "44444444-4444-4444-8444-444444444444",
    fit: "cover",
    muted: true,
    visualPolicy: "replace_full_canvas_keep_narrative_audio",
  }]);
  assert.deepEqual(resolveHvePreviewFrame(brollPlan, 1_500_000)?.layers, []);
});
