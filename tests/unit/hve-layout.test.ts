import assert from "node:assert/strict";
import test from "node:test";
import { HVE_TICKS_PER_SECOND, HveLayoutPlanningError, buildUserVerifiedFaceGridSlots, buildUserVerifiedScreenCompositeSlots, resolveLayoutSegments, type ClipDocumentV2, type TimeMapEntry } from "../../packages/contracts/src/index.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";
const clipId = "33333333-3333-4333-8333-333333333333";
const styleVersionId = "44444444-4444-4444-8444-444444444444";
const layoutId = "55555555-5555-4555-8555-555555555555";
const narrativeId = "66666666-6666-4666-8666-666666666666";

const sourceSlot = (slotId: string, kind: "source" | "face" | "screen" | "gameplay" = "source") => ({
  slotId,
  regionRef: { analysisId, trackId: `${slotId}-track`, kind },
  fit: "cover" as const,
});

function documentFor(template: string, slots = [sourceSlot("primary")], anchor: ClipDocumentV2["layout"][number]["anchor"] = {
  start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 },
}): ClipDocumentV2 {
  return {
    schemaVersion: 2,
    clipId,
    sourceRefs: [{ sourceId, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: HVE_TICKS_PER_SECOND, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{ id: narrativeId, sourceId, sourceRange: { startUs: 0, endUs: 10_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
    layout: [{
      id: layoutId, anchor, template, slots,
      provenance: { origin: "user", reasonCode: "UNIT_TEST" }, lockedByUser: true,
    }],
    captions: {
      enabled: true, language: "ru", words: [],
      style: {
        preset: "clean", fontFamily: "HVE Sans", fontSizePx: 48, fontWeight: 700, uppercase: false,
        maxWordsPerLine: 4, maxLines: 2, position: "bottom", safeMarginPx: 80,
        color: "#ffffff", activeColor: "#10b8f4", outlineColor: "#000000", outlinePx: 2, background: false,
      },
    },
    layers: [],
    audio: {
      sourceCuts: [], pauseRemoval: { enabled: false, minimumUs: 0, beforePaddingUs: 0, afterPaddingUs: 0, crossfadeUs: 0 },
      loudness: { targetLufs: -14, truePeakDb: -1 },
    },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 6500, audioBitrateKbps: 160, watermark: false },
    styleVersionId, analysisId, plannerVersion: "hve-layout-unit", rendererVersion: "hve-layout-unit",
  };
}

const fullTimeMap: TimeMapEntry[] = [{
  sourceId, sourceRange: { startUs: 0, endUs: 10_000_000 }, outputRange: { startUs: 0, endUs: 10_000_000 }, rate: { numerator: 1, denominator: 1 },
}];

test("gameplay layout resolves the documented 30/70 facecam/gameplay geometry", () => {
  const document = documentFor("gameplay_facecam", [sourceSlot("facecam", "face"), sourceSlot("gameplay", "gameplay")]);
  const result = resolveLayoutSegments(document, fullTimeMap);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.segments[0]?.slots.map((slot) => slot.destinationPx), [
    { x: 0, y: 0, width: 1080, height: 576 },
    { x: 0, y: 576, width: 1080, height: 1344 },
  ]);
  assert.deepEqual(result.segments[0]?.slots.map((slot) => slot.fit), ["cover", "cover"]);
  assert.deepEqual(result.segments[0]?.slots[1]?.cropKeyframes, [
    { atUs: 0, crop: { x: 0, y: 0, width: 1, height: 1 } },
    { atUs: 9_999_999, crop: { x: 0, y: 0, width: 1, height: 1 } },
  ]);
});

test("a user-verified gameplay composite keeps the face track and screen crop explicit", () => {
  const document = documentFor("portrait_focus");
  const slots = buildUserVerifiedScreenCompositeSlots(document, {
    template: "gameplay_facecam",
    faceTrackId: "face-1",
    screenCrop: { x: 0, y: 0.25, width: 1, height: 0.75 },
  });
  document.layout[0] = { ...document.layout[0]!, template: "gameplay_facecam", slots };
  const result = resolveLayoutSegments(document, fullTimeMap, [], {
    analysisId,
    source: { sourceId, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    graph: {
      schemaVersion: 1, sourceId, sourceHash: "a".repeat(64), engineVersion: "fixture",
      generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 10_000_000,
      shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
      regions: [{
        id: "face-1", kind: "face", range: { startUs: 0, endUs: 10_000_000 }, confidence: 0.95,
        provenance: { detector: "fixture", modelVersion: "fixture-1" },
        keyframes: [
          { atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.3 }, confidence: 0.95 },
          { atUs: 9_999_999, box: { x: 0.5, y: 0.5, width: 0.2, height: 0.3 }, confidence: 0.95 },
        ],
      }],
    },
  });
  assert.equal(result.warnings.length, 0);
  const [facecam, gameplay] = result.segments[0]!.slots;
  assert.equal(facecam?.fit, "smart_cover");
  // The wide 30% facecam destination spans the whole source width, so its
  // motion is vertical here. This still proves the verified face track, not a
  // static crop, drives the top slot.
  assert.ok((facecam?.cropKeyframes.at(-1)?.crop.y ?? 0) > (facecam?.cropKeyframes[0]?.crop.y ?? 1));
  assert.equal(gameplay?.fit, "contain");
  assert.deepEqual(gameplay?.cropKeyframes[0]?.crop, { x: 0, y: 0.25, width: 1, height: 0.75 });
});

test("a user-verified face grid binds each visible slot to an explicit distinct face track", () => {
  const document = documentFor("portrait_focus");
  const slots = buildUserVerifiedFaceGridSlots(document, {
    template: "grid_3",
    faceTrackIds: ["face-alex", "face-maria", "face-timur"],
  });
  document.layout[0] = { ...document.layout[0]!, template: "grid_3", slots };
  const result = resolveLayoutSegments(document, fullTimeMap, [], {
    analysisId,
    source: { sourceId, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    graph: {
      schemaVersion: 1, sourceId, sourceHash: "a".repeat(64), engineVersion: "fixture",
      generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 10_000_000,
      shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
      regions: ["face-alex", "face-maria", "face-timur"].map((id, index) => ({
        id, kind: "face" as const, range: { startUs: 0, endUs: 10_000_000 }, confidence: 0.95,
        provenance: { detector: "fixture", modelVersion: "fixture-1" },
        keyframes: [
          { atUs: 0, box: { x: index * 0.2, y: 0.1, width: 0.2, height: 0.3 }, confidence: 0.95 },
          { atUs: 9_999_999, box: { x: index * 0.2, y: 0.1, width: 0.2, height: 0.3 }, confidence: 0.95 },
        ],
      })),
    },
  });
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.segments[0]?.slots.map((slot) => slot.destinationPx), [
    { x: 0, y: 0, width: 1080, height: 960 },
    { x: 0, y: 960, width: 540, height: 960 },
    { x: 540, y: 960, width: 540, height: 960 },
  ]);
  assert.deepEqual(result.segments[0]?.slots.map((slot) => slot.source.trackId), [
    "source-face-1", "source-face-2", "source-face-3",
  ]);
  // The planner expands face boxes to match each destination aspect ratio, so
  // assert ordered independent trajectories rather than pinning its crop math.
  const cropXs = result.segments[0]?.slots.map((slot) => slot.cropKeyframes[0]?.crop.x ?? -1) ?? [];
  assert.equal(cropXs.length, 3);
  assert.ok(cropXs[0]! < cropXs[1]! && cropXs[1]! < cropXs[2]!);
});

test("a user-verified grid rejects missing or duplicate participant tracks", () => {
  const document = documentFor("portrait_focus");
  assert.throws(
    () => buildUserVerifiedFaceGridSlots(document, { template: "grid_4", faceTrackIds: ["face-1", "face-2", "face-3"] }),
    (error: unknown) => error instanceof HveLayoutPlanningError && error.code === "HVE6_GRID_TRACKS_INVALID",
  );
  assert.throws(
    () => buildUserVerifiedFaceGridSlots(document, { template: "grid_3", faceTrackIds: ["face-1", "face-1", "face-3"] }),
    (error: unknown) => error instanceof HveLayoutPlanningError && error.code === "HVE6_GRID_TRACKS_INVALID",
  );
});

test("a four-person grid preserves all four explicit track assignments and geometry", () => {
  const document = documentFor("portrait_focus");
  const slots = buildUserVerifiedFaceGridSlots(document, {
    template: "grid_4",
    faceTrackIds: ["face-1", "face-2", "face-3", "face-4"],
  });
  assert.deepEqual(slots.map((slot) => slot.cropTrack?.trackId), [
    "face-1", "face-2", "face-3", "face-4",
  ]);
  document.layout[0] = { ...document.layout[0]!, template: "grid_4", slots };
  const result = resolveLayoutSegments(document, fullTimeMap);
  assert.deepEqual(result.segments[0]?.slots.map((slot) => slot.destinationPx), [
    { x: 0, y: 0, width: 540, height: 960 },
    { x: 540, y: 0, width: 540, height: 960 },
    { x: 0, y: 960, width: 540, height: 960 },
    { x: 540, y: 960, width: 540, height: 960 },
  ]);
});

test("an unknown layout falls back visibly to portrait focus instead of silently choosing geometry", () => {
  const result = resolveLayoutSegments(documentFor("future_layout"), fullTimeMap);
  assert.equal(result.segments[0]?.slots.length, 1);
  assert.deepEqual(result.segments[0]?.slots[0]?.destinationPx, { x: 0, y: 0, width: 1080, height: 1920 });
  assert.equal(result.warnings[0]?.code, "HVE_LAYOUT_TEMPLATE_FALLBACK");
  assert.equal(result.warnings[0]?.applied, "portrait_focus");
});

test("smart cover remains visibly downgraded until the perception crop artifact exists", () => {
  const document = documentFor("portrait_focus");
  document.layout[0]!.slots[0]!.fit = "smart_cover";
  const result = resolveLayoutSegments(document, fullTimeMap);
  assert.equal(result.warnings[0]?.code, "HVE_LAYOUT_SMART_CROP_FALLBACK");
  assert.equal(result.warnings[0]?.applied, "cover");
});

test("a verified face track becomes an output-clock crop trajectory without claiming active speaker", () => {
  const document = documentFor("portrait_focus");
  document.layout[0]!.slots[0]!.fit = "smart_cover";
  document.layout[0]!.slots[0]!.cropTrack = { analysisId, trackId: "face-1" };
  const result = resolveLayoutSegments(document, fullTimeMap, [], {
    analysisId,
    source: { sourceId, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    graph: {
      schemaVersion: 1,
      sourceId,
      sourceHash: "a".repeat(64),
      engineVersion: "hve-vision-unit",
      generatedAt: "2026-08-03T00:00:00.000Z",
      durationUs: 10_000_000,
      shots: [],
      regions: [{
        id: "face-1", kind: "face", range: { startUs: 0, endUs: 10_000_000 }, confidence: 0.92,
        provenance: { detector: "fixture", modelVersion: "fixture-1" },
        keyframes: [
          { atUs: 0, box: { x: 0.10, y: 0.20, width: 0.20, height: 0.30 }, confidence: 0.96 },
          { atUs: 9_999_999, box: { x: 0.60, y: 0.20, width: 0.20, height: 0.30 }, confidence: 0.94 },
        ],
      }],
      speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
    },
  });
  assert.equal(result.warnings.length, 0);
  const keyframes = result.segments[0]?.slots[0]?.cropKeyframes ?? [];
  assert.deepEqual(keyframes.map((item) => item.atUs), [0, 9_999_999]);
  assert.ok((keyframes[1]?.crop.x ?? 0) > (keyframes[0]?.crop.x ?? 1));
  assert.equal(keyframes[0]?.crop.width, keyframes[1]?.crop.width);
  assert.equal(keyframes[0]?.crop.height, keyframes[1]?.crop.height);
});

test("a mismatched perception artifact visibly falls back instead of moving another source", () => {
  const document = documentFor("portrait_focus");
  document.layout[0]!.slots[0]!.fit = "smart_cover";
  document.layout[0]!.slots[0]!.cropTrack = { analysisId, trackId: "face-1" };
  const result = resolveLayoutSegments(document, fullTimeMap, [], {
    analysisId: "77777777-7777-4777-8777-777777777777",
    source: { sourceId, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    graph: {
      schemaVersion: 1, sourceId, sourceHash: "a".repeat(64), engineVersion: "fixture",
      generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 10_000_000,
      shots: [], regions: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
    },
  });
  assert.deepEqual(result.segments[0]?.slots[0]?.cropKeyframes, [
    { atUs: 0, crop: { x: 0, y: 0, width: 1, height: 1 } },
    { atUs: 9_999_999, crop: { x: 0, y: 0, width: 1, height: 1 } },
  ]);
  assert.deepEqual(result.warnings.map((item) => item.code), ["HVE_LAYOUT_TRACK_FALLBACK", "HVE_LAYOUT_SMART_CROP_FALLBACK"]);
});

test("a template with an unassigned required region fails before rendering", () => {
  assert.throws(
    () => resolveLayoutSegments(documentFor("split_top_bottom", [sourceSlot("primary")]), fullTimeMap),
    (error: unknown) => error instanceof HveLayoutPlanningError && error.code === "HVE_LAYOUT_SLOT_MISSING",
  );
});

test("a source-word anchor resolves on the shared output clock", () => {
  const anchor: ClipDocumentV2["layout"][number]["anchor"] = {
    start: { kind: "source_word", wordId: "word-1", edge: "start" },
    end: { kind: "source_word", wordId: "word-2", edge: "end" },
  };
  const result = resolveLayoutSegments(documentFor("portrait_focus", [sourceSlot("primary")], anchor), fullTimeMap, [
    { wordId: "word-1", sourceId, sourceRange: { startUs: 1_000_000, endUs: 1_400_000 }, text: "один" },
    { wordId: "word-2", sourceId, sourceRange: { startUs: 1_400_000, endUs: 2_000_000 }, text: "два" },
  ]);
  assert.deepEqual(result.segments[0]?.outputRange, { startUs: 1_000_000, endUs: 2_000_000 });
});

test("overlapping layout segments are rejected instead of leaving renderer order ambiguous", () => {
  const document = documentFor("portrait_focus");
  document.layout.push({
    ...document.layout[0]!,
    id: "77777777-7777-4777-8777-777777777777",
    anchor: { start: { kind: "narrative_offset", narrativeSegmentId: narrativeId, offsetUs: 5_000_000 }, end: { kind: "clip_end", offsetUs: 0 } },
  });
  assert.throws(
    () => resolveLayoutSegments(document, fullTimeMap),
    (error: unknown) => error instanceof HveLayoutPlanningError && error.code === "HVE_LAYOUT_SEGMENTS_OVERLAP",
  );
});
