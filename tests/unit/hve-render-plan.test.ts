import assert from "node:assert/strict";
import test from "node:test";
import { buildUserVerifiedFaceGridSlots, buildUserVerifiedScreenCompositeSlots, clipDocumentV2Schema } from "../../packages/contracts/src/index.js";
import { Hve2PlanNotExecutableError, Hve3PlanNotExecutableError, Hve5PlanNotExecutableError, resolveHve2ExecutionPlan, resolveHve3ExecutionPlan, resolveHve5ExecutionPlan, resolveHveEditorSequencePlan, resolveHveEditorVisualPreviewPlan } from "../../services/control-api/src/services/hve/render-plan.js";

const ids = {
  clip: "10000000-0000-4000-8000-000000000001",
  source: "20000000-0000-4000-8000-000000000001",
  style: "30000000-0000-4000-8000-000000000001",
  analysis: "40000000-0000-4000-8000-000000000001",
  narrative: "50000000-0000-4000-8000-000000000001",
  layout: "60000000-0000-4000-8000-000000000001",
};

function documentFixture() {
  return clipDocumentV2Schema.parse({
    schemaVersion: 2,
    clipId: ids.clip,
    sourceRefs: [{ sourceId: ids.source, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{
      id: ids.narrative, sourceId: ids.source, sourceRange: { startUs: 0, endUs: 3_000_000 },
      enabled: true, order: 0, transcriptWordIds: ["word-a", "word-b"], transitionIn: "cut", transitionOut: "cut",
    }],
    layout: [{
      id: ids.layout,
      anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      template: "fill",
      slots: [{ slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "source", kind: "source" }, fit: "cover" }],
      provenance: { origin: "engine", reasonCode: "TEST" },
      lockedByUser: false,
    }],
    captions: {
      enabled: true,
      language: "ru",
      words: [],
      style: {
        preset: "active_word", fontFamily: "HVE Sans", fontSizePx: 56, fontWeight: 700,
        uppercase: false, maxWordsPerLine: 4, maxLines: 2, position: "bottom", safeMarginPx: 100,
        color: "#ffffff", activeColor: "#10b8f4", outlineColor: "#06131a", outlinePx: 3, background: false,
      },
    },
    layers: [],
    audio: {
      sourceCuts: [{ sourceId: ids.source, sourceRange: { startUs: 1_000_000, endUs: 2_000_000 }, reason: "pause" }],
      pauseRemoval: { enabled: false, minimumUs: 0, beforePaddingUs: 0, afterPaddingUs: 0, crossfadeUs: 0 },
      loudness: { targetLufs: -16, truePeakDb: -1.5 },
    },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 5_000, audioBitrateKbps: 128, watermark: false },
    styleVersionId: ids.style,
    analysisId: ids.analysis,
    plannerVersion: "hve-2-test",
    rendererVersion: "hve-2-test",
  });
}

test("HVE-2 turns one immutable document into shared audio/video/caption execution input", async () => {
  const plan = await resolveHve2ExecutionPlan(documentFixture(), [
    { wordId: "word-a", sourceId: ids.source, sourceRange: { startUs: 100_100, endUs: 500_100 }, text: "Первое" },
    { wordId: "word-b", sourceId: ids.source, sourceRange: { startUs: 2_100_100, endUs: 2_500_100 }, text: "слово", speakerId: "speaker-a" },
  ]);
  assert.deepEqual(plan.resolvedPlan.timeMap, [
    { sourceId: ids.source, sourceRange: { startUs: 0, endUs: 1_000_000 }, outputRange: { startUs: 0, endUs: 1_000_000 }, rate: { numerator: 1, denominator: 1 } },
    { sourceId: ids.source, sourceRange: { startUs: 2_000_000, endUs: 3_000_000 }, outputRange: { startUs: 1_000_000, endUs: 2_000_000 }, rate: { numerator: 1, denominator: 1 } },
  ]);
  assert.deepEqual(plan.resolvedPlan.audioPlan.timeMap, plan.resolvedPlan.timeMap);
  assert.equal(plan.subtitleCues[0]?.startMs, 100);
  assert.equal(plan.subtitleCues[0]?.words[1]?.startMs, 1_100);
  assert.equal(plan.subtitleCues[0]?.words[1]?.speakerId, "speaker-a");
  assert.match(plan.documentHash, /^[a-f0-9]{64}$/);
});

test("HVE-2 rejects a layer instead of silently losing it in the legacy renderer", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000001",
    type: "text",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 1,
    anchor: "top_center",
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    opacity: 1,
    collisionPolicy: "warn",
    text: "Новый заголовок",
    styleRef: "hve-title-v1",
  }];
  await assert.rejects(
    () => resolveHve2ExecutionPlan(document, []),
    (error: unknown) => error instanceof Hve2PlanNotExecutableError && error.code === "HVE2_PRODUCTION_LAYERS_UNSUPPORTED",
  );
});

test("editor source review resolves the same output clock even before a visual layer is executable", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000001",
    type: "text",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 1,
    anchor: "top_center",
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    opacity: 1,
    collisionPolicy: "warn",
    text: "Новый заголовок",
    styleRef: "headline",
  }];
  const sequence = await resolveHveEditorSequencePlan(document, []);
  assert.equal(sequence.outputDurationUs, 2_000_000);
  assert.deepEqual(sequence.timeMap.map((entry) => entry.sourceRange), [
    { startUs: 0, endUs: 1_000_000 },
    { startUs: 2_000_000, endUs: 3_000_000 },
  ]);
  assert.match(sequence.documentHash, /^[a-f0-9]{64}$/);
});

test("editor composition preview projects the same immutable HVE-3 geometry without private asset data", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000001",
    type: "text",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 1,
    anchor: "top_center",
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    opacity: 1,
    collisionPolicy: "warn",
    text: "Проверяемый заголовок",
    styleRef: "hve-title-v1",
  }];
  const preview = await resolveHveEditorVisualPreviewPlan(document, []);
  assert.equal(preview.resolvedPlan.layoutSegments.length, 1);
  assert.equal(preview.resolvedPlan.layerPlan[0]?.type, "text");
  assert.equal(preview.captionStyle.preset, "active_word");
  assert.match(preview.documentHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(preview.resolvedPlan).includes("objectKey"), false);
  assert.equal(JSON.stringify(preview.resolvedPlan).includes("bucket"), false);
});

test("editor composition preview fails closed when it would need tracking or a private asset", async () => {
  const tracked = documentFixture();
  tracked.layout[0]!.slots[0]!.cropTrack = { analysisId: ids.analysis, trackId: "face-a" };
  await assert.rejects(
    () => resolveHveEditorVisualPreviewPlan(tracked, []),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE_EDITOR_PREVIEW_PERCEPTION_REQUIRED",
  );

  const branded = documentFixture();
  branded.layers = [{
    id: "70000000-0000-4000-8000-000000000002",
    type: "logo",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "top_right",
    box: { x: 0.75, y: 0.05, width: 0.2, height: 0.1 },
    opacity: 1,
    collisionPolicy: "warn",
    assetId: "70000000-0000-4000-8000-000000000003",
  }];
  await assert.rejects(
    () => resolveHveEditorVisualPreviewPlan(branded, []),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE_EDITOR_PREVIEW_PRIVATE_ASSET_REQUIRED",
  );
});

test("HVE-2 resolves a pause crossfade into the shared map and requires dual-media source review", async () => {
  const document = documentFixture();
  document.audio.pauseRemoval.crossfadeUs = 30_000;
  const plan = await resolveHve2ExecutionPlan(document, []);
  assert.deepEqual(plan.resolvedPlan.timeMap.map((entry) => entry.outputRange), [
    { startUs: 0, endUs: 1_000_000 },
    { startUs: 970_000, endUs: 1_970_000 },
  ]);
  assert.equal(plan.resolvedPlan.timeMap[1]?.transitionInUs, 30_000);
  const sequence = await resolveHveEditorSequencePlan(document, []);
  assert.equal(sequence.previewMode, "dual_media_crossfade");
  assert.equal(sequence.outputDurationUs, 1_970_000);
  const hve3 = await resolveHve3ExecutionPlan(document, []);
  assert.deepEqual(hve3.resolvedPlan.layoutSegments[0]?.outputRange, { startUs: 0, endUs: 1_970_000 });
});

test("HVE-3 turns a source-only full-clip layout into resolved slot geometry", async () => {
  const plan = await resolveHve3ExecutionPlan(documentFixture(), []);
  assert.equal(plan.resolvedPlan.layoutSegments.length, 1);
  assert.deepEqual(plan.resolvedPlan.layoutSegments[0]?.outputRange, { startUs: 0, endUs: 2_000_000 });
  assert.deepEqual(plan.resolvedPlan.layoutSegments[0]?.slots[0]?.destinationPx, { x: 0, y: 0, width: 1080, height: 1920 });
  assert.equal(plan.resolvedPlan.layoutSegments[0]?.slots[0]?.fit, "cover");
  assert.equal(plan.resolvedPlan.warnings[0]?.code, "HVE_LAYOUT_TEMPLATE_FALLBACK");
});

test("HVE-3 accepts contiguous hard-cut source layouts on the shared output clock", async () => {
  const document = documentFixture();
  const split = { kind: "narrative_offset" as const, narrativeSegmentId: ids.narrative, offsetUs: 1_000_000 };
  document.layout = [
    {
      id: ids.layout,
      anchor: { start: { kind: "clip_start" }, end: split },
      template: "portrait_focus",
      slots: [{
        slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "left-window", kind: "source" },
        fit: "cover", manualCrop: { x: 0, y: 0, width: 0.5, height: 1 },
      }],
      provenance: { origin: "engine", reasonCode: "TEST" }, lockedByUser: false,
    },
    {
      id: "60000000-0000-4000-8000-000000000002",
      anchor: { start: split, end: { kind: "clip_end", offsetUs: 0 } },
      template: "portrait_focus",
      slots: [{
        slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "right-window", kind: "source" },
        fit: "cover", manualCrop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      }],
      provenance: { origin: "engine", reasonCode: "TEST" }, lockedByUser: false,
    },
  ];

  const plan = await resolveHve3ExecutionPlan(document, []);
  assert.deepEqual(plan.resolvedPlan.layoutSegments.map((segment) => segment.outputRange), [
    { startUs: 0, endUs: 1_000_000 },
    { startUs: 1_000_000, endUs: 2_000_000 },
  ]);
  assert.equal(plan.resolvedPlan.layoutSegments[0]?.slots[0]?.cropKeyframes[0]?.crop.x, 0);
  assert.equal(plan.resolvedPlan.layoutSegments[1]?.slots[0]?.cropKeyframes[0]?.crop.x, 0.5);
});

test("HVE-3 resolves a V2 title to explicit output geometry and timing", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000001",
    type: "text",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "top_center",
    box: { x: 0.1, y: 0.05, width: 0.8, height: 0.2 },
    opacity: 0.8,
    collisionPolicy: "warn",
    text: "Проверяемый заголовок",
    styleRef: "hve-title-v1",
  }];
  const plan = await resolveHve3ExecutionPlan(document, []);
  assert.deepEqual(plan.resolvedPlan.layerPlan, [{
    layerId: document.layers[0]!.id,
    type: "text",
    outputRange: { startUs: 0, endUs: 2_000_000 },
    destinationPx: { x: 108, y: 96, width: 864, height: 384 },
    opacity: 0.8,
    zIndex: 10,
    text: "Проверяемый заголовок",
    style: {
      id: "hve-title-v1",
      fontFamily: "DejaVu Sans",
      fontSizePx: 66,
      fontWeight: 700,
      color: "#ffffff",
      outlineColor: "#06131a",
      outlinePx: 3,
      background: true,
    },
  }]);
});

test("HVE-3 moves a timed title out of an active caption safe zone only when the document requests it", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000015",
    type: "text",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "bottom_center",
    // This box intersects the conservative bottom-caption reserve. Its
    // explicit `move` policy authorises the planner-owned relocation; a
    // `warn` layer deliberately keeps its user-selected geometry instead.
    box: { x: 0.1, y: 0.8, width: 0.8, height: 0.15 },
    opacity: 1,
    collisionPolicy: "move",
    text: "Не закрывать субтитры",
    styleRef: "hve-title-v1",
  }];
  const plan = await resolveHve3ExecutionPlan(document, [
    { wordId: "word-a", sourceId: ids.source, sourceRange: { startUs: 100_000, endUs: 800_000 }, text: "субтитры" },
  ]);
  const title = plan.resolvedPlan.layerPlan[0];
  assert.equal(title?.type, "text");
  if (title?.type === "text") {
    assert.deepEqual(title.destinationPx, { x: 108, y: 0, width: 864, height: 288 });
  }
  assert.ok(plan.resolvedPlan.warnings.some((warning) => (
    warning.code === "HVE_LAYER_CAPTION_COLLISION_MOVED"
    && warning.requested === "move"
    && warning.applied === "moved_to_caption_safe_region"
  )));
});

test("HVE-3 leaves a caption collision visible when its policy is warn", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000016",
    type: "text",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "bottom_center",
    box: { x: 0.1, y: 0.8, width: 0.8, height: 0.15 },
    opacity: 1,
    collisionPolicy: "warn",
    text: "Проверить вручную",
    styleRef: "hve-title-v1",
  }];
  const plan = await resolveHve3ExecutionPlan(document, [
    { wordId: "word-a", sourceId: ids.source, sourceRange: { startUs: 100_000, endUs: 800_000 }, text: "субтитры" },
  ]);
  const title = plan.resolvedPlan.layerPlan[0];
  assert.equal(title?.type, "text");
  if (title?.type === "text") assert.equal(title.destinationPx.y, 1536);
  assert.ok(plan.resolvedPlan.warnings.some((warning) => (
    warning.code === "HVE_LAYER_CAPTION_COLLISION"
    && warning.requested === "warn"
    && warning.applied === "warn"
  )));
});

test("HVE-3 refuses asset layers until the verified asset resolver exists", async () => {
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000002",
    type: "logo",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "top_right",
    box: { x: 0.75, y: 0.05, width: 0.2, height: 0.1 },
    opacity: 1,
    collisionPolicy: "warn",
    assetId: "70000000-0000-4000-8000-000000000003",
  }];
  await assert.rejects(
    () => resolveHve3ExecutionPlan(document, []),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE_LAYER_ASSET_RESOLVER_REQUIRED",
  );
});

test("HVE-3 resolves a workspace-verified static logo by immutable content hash", async () => {
  const document = documentFixture();
  const assetId = "70000000-0000-4000-8000-000000000003";
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000002",
    type: "logo",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "top_right",
    box: { x: 0.75, y: 0.05, width: 0.2, height: 0.1 },
    opacity: 0.65,
    collisionPolicy: "warn",
    assetId,
  }];
  const plan = await resolveHve3ExecutionPlan(document, [], new Map([[assetId, {
    assetId,
    sha256: "b".repeat(64),
    mimeType: "image/png" as const,
    byteSize: 12_345,
  }]]));
  assert.deepEqual(plan.resolvedPlan.layerPlan, [{
    layerId: document.layers[0]!.id,
    type: "logo",
    outputRange: { startUs: 0, endUs: 2_000_000 },
    destinationPx: { x: 810, y: 96, width: 216, height: 192 },
    opacity: 0.65,
    zIndex: 10,
    asset: { assetId, sha256: "b".repeat(64), mimeType: "image/png", byteSize: 12_345 },
    fit: "contain",
  }]);
});

test("HVE-3 resolves only a worker-verified MP4 as a muted timed video overlay", async () => {
  const document = documentFixture();
  const assetId = "70000000-0000-4000-8000-000000000004";
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000005",
    type: "video",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative",
    zIndex: 10,
    anchor: "bottom_center",
    box: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
    opacity: 0.9,
    collisionPolicy: "warn",
    assetId,
    loop: false,
  }];
  const plan = await resolveHve3ExecutionPlan(document, [], new Map([[assetId, {
    assetId, kind: "video" as const,
    sha256: "c".repeat(64),
    mimeType: "video/mp4" as const,
    byteSize: 12_345,
    durationMs: 2_000,
    profile: "hve-timed-visual-h264-aac-v1" as const,
    audioPolicy: "muted_until_timed_audio_is_implemented" as const,
  }]]));
  assert.deepEqual(plan.resolvedPlan.layerPlan, [{
    layerId: document.layers[0]!.id,
    type: "video",
    outputRange: { startUs: 0, endUs: 2_000_000 },
    destinationPx: { x: 108, y: 1344, width: 864, height: 384 },
    opacity: 0.9,
    zIndex: 10,
    asset: {
      assetId, kind: "video", sha256: "c".repeat(64), mimeType: "video/mp4", byteSize: 12_345,
      durationMs: 2_000, profile: "hve-timed-visual-h264-aac-v1",
      audioPolicy: "muted_until_timed_audio_is_implemented",
    },
    loop: false,
    fit: "contain",
  }]);
});

test("HVE-3 refuses a non-looping timed overlay that would freeze before its output range ends", async () => {
  const document = documentFixture();
  const assetId = "70000000-0000-4000-8000-000000000006";
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000007",
    type: "video",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative", zIndex: 10, anchor: "center",
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, opacity: 1, collisionPolicy: "warn", assetId, loop: false,
  }];
  await assert.rejects(
    () => resolveHve3ExecutionPlan(document, [], new Map([[assetId, {
      assetId, kind: "video" as const, sha256: "d".repeat(64), mimeType: "video/mp4" as const, byteSize: 12_345,
      durationMs: 500, profile: "hve-timed-visual-h264-aac-v1" as const,
      audioPolicy: "muted_until_timed_audio_is_implemented" as const,
    }]])),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE_LAYER_TIMED_ASSET_TOO_SHORT",
  );
});

test("HVE-3 allows a shorter verified timed overlay only with an explicit loop", async () => {
  const document = documentFixture();
  const assetId = "70000000-0000-4000-8000-000000000008";
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000009",
    type: "video",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative", zIndex: 10, anchor: "center",
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, opacity: 1, collisionPolicy: "warn", assetId, loop: true,
  }];
  const plan = await resolveHve3ExecutionPlan(document, [], new Map([[assetId, {
    assetId, kind: "video" as const, sha256: "e".repeat(64), mimeType: "video/mp4" as const, byteSize: 12_345,
    durationMs: 500, profile: "hve-timed-visual-h264-aac-v1" as const,
    audioPolicy: "muted_until_timed_audio_is_implemented" as const,
  }]]));
  assert.equal(plan.resolvedPlan.layerPlan[0]?.type, "video");
  if (plan.resolvedPlan.layerPlan[0]?.type === "video") assert.equal(plan.resolvedPlan.layerPlan[0].loop, true);
});

test("HVE-8 resolves verified B-roll as a full-canvas muted visual replacement", async () => {
  const document = documentFixture();
  const assetId = "70000000-0000-4000-8000-000000000010";
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000011",
    type: "broll",
    anchorRange: {
      start: { kind: "narrative_offset", narrativeSegmentId: ids.narrative, offsetUs: 500_000 },
      end: { kind: "narrative_offset", narrativeSegmentId: ids.narrative, offsetUs: 1_500_000 },
    },
    followPolicy: "follow_narrative", zIndex: 0, anchor: "center",
    box: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, collisionPolicy: "warn",
    assetId, muted: true,
  }];
  const plan = await resolveHve3ExecutionPlan(document, [], new Map([[assetId, {
    assetId, kind: "broll" as const, sha256: "f".repeat(64), mimeType: "video/mp4" as const,
    byteSize: 12_345, durationMs: 1_000, profile: "hve-timed-visual-h264-aac-v1" as const,
    audioPolicy: "muted_until_timed_audio_is_implemented" as const,
  }]]));
  assert.deepEqual(plan.resolvedPlan.layerPlan, [{
    layerId: document.layers[0]!.id,
    type: "broll",
    outputRange: { startUs: 500_000, endUs: 1_500_000 },
    destinationPx: { x: 0, y: 0, width: 1080, height: 1920 },
    opacity: 1,
    zIndex: 0,
    asset: {
      assetId, kind: "broll", sha256: "f".repeat(64), mimeType: "video/mp4", byteSize: 12_345,
      durationMs: 1_000, profile: "hve-timed-visual-h264-aac-v1",
      audioPolicy: "muted_until_timed_audio_is_implemented",
    },
    muted: true,
    visualPolicy: "replace_full_canvas_keep_narrative_audio",
    fit: "cover",
  }]);
});

test("HVE-8 rejects unsafe B-roll instead of degrading it into an overlay", async () => {
  const assetId = "70000000-0000-4000-8000-000000000012";
  const asset = {
    assetId, kind: "broll" as const, sha256: "a".repeat(64), mimeType: "video/mp4" as const,
    byteSize: 12_345, durationMs: 2_000, profile: "hve-timed-visual-h264-aac-v1" as const,
    audioPolicy: "muted_until_timed_audio_is_implemented" as const,
  };
  const document = documentFixture();
  document.layers = [{
    id: "70000000-0000-4000-8000-000000000013", type: "broll",
    anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
    followPolicy: "follow_narrative", zIndex: 0, anchor: "center",
    box: { x: 0.1, y: 0, width: 0.9, height: 1 }, opacity: 1, collisionPolicy: "warn", assetId, muted: true,
  }];
  await assert.rejects(
    () => resolveHve3ExecutionPlan(document, [], new Map([[assetId, asset]])),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE_BROLL_FULL_CANVAS_REQUIRED",
  );
  const broll = document.layers[0];
  if (!broll || broll.type !== "broll") throw new Error("B-roll fixture was not preserved");
  broll.box = { x: 0, y: 0, width: 1, height: 1 };
  broll.muted = false;
  await assert.rejects(
    () => resolveHve3ExecutionPlan(document, [], new Map([[assetId, asset]])),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE_BROLL_AUDIO_UNSUPPORTED",
  );
});

test("HVE-3 refuses a face role until an analysis artifact can provide the crop", async () => {
  const document = documentFixture();
  document.layout[0]!.template = "portrait_focus";
  document.layout[0]!.slots[0]!.regionRef.kind = "face";
  await assert.rejects(
    () => resolveHve3ExecutionPlan(document, []),
    (error: unknown) => error instanceof Hve3PlanNotExecutableError && error.code === "HVE3_REGION_ARTIFACT_REQUIRED",
  );
});

test("HVE-5 converts an explicitly bound face artifact to one deterministic crop trajectory", async () => {
  const document = documentFixture();
  document.layout[0]!.template = "portrait_focus";
  document.layout[0]!.slots[0]!.fit = "smart_cover";
  document.layout[0]!.slots[0]!.cropTrack = { analysisId: ids.analysis, trackId: "face-1" };
  const plan = await resolveHve5ExecutionPlan(document, [], {
    analysisId: ids.analysis,
    source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    graph: {
      schemaVersion: 1, sourceId: ids.source, sourceHash: "a".repeat(64), engineVersion: "hve-vision-test",
      generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 3_000_000,
      shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
      regions: [{
        id: "face-1", kind: "face", range: { startUs: 0, endUs: 3_000_000 }, confidence: 0.95,
        provenance: { detector: "fixture", modelVersion: "fixture-1" },
        keyframes: [
          { atUs: 0, box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, confidence: 0.95 },
          { atUs: 2_999_999, box: { x: 0.6, y: 0.2, width: 0.2, height: 0.3 }, confidence: 0.95 },
        ],
      }],
    },
  });
  const keyframes = plan.resolvedPlan.layoutSegments[0]?.slots[0]?.cropKeyframes ?? [];
  assert.deepEqual(keyframes.map((item) => item.atUs), [0, 999_999, 1_000_000, 1_999_999]);
  assert.ok((keyframes.at(-1)?.crop.x ?? 0) > (keyframes[0]?.crop.x ?? 1));
  assert.ok(!plan.resolvedPlan.warnings.some((item) => item.code === "HVE_LAYOUT_SMART_CROP_FALLBACK"));
});

test("HVE-5 rejects an artifact selected for another analysis version", async () => {
  await assert.rejects(
    () => resolveHve5ExecutionPlan(documentFixture(), [], {
      analysisId: "40000000-0000-4000-8000-000000000002",
      source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
      graph: {
        schemaVersion: 1, sourceId: ids.source, sourceHash: "a".repeat(64), engineVersion: "fixture",
        generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 3_000_000,
        shots: [], regions: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
      },
    }),
    (error: unknown) => error instanceof Hve5PlanNotExecutableError && error.code === "HVE5_ANALYSIS_ID_MISMATCH",
  );
});

test("HVE-6 rejects a tracked gameplay composite without dense clip evidence", async () => {
  const document = documentFixture();
  document.layout[0]!.template = "gameplay_facecam";
  document.layout[0]!.slots = buildUserVerifiedScreenCompositeSlots(document, {
    template: "gameplay_facecam",
    screenCrop: { x: 0, y: 0.25, width: 1, height: 0.75 },
    faceTrackId: "face-1",
  });
  await assert.rejects(
    () => resolveHve5ExecutionPlan(document, [], {
      analysisId: ids.analysis,
      source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
      graph: {
        schemaVersion: 1, sourceId: ids.source, sourceHash: "a".repeat(64), engineVersion: "fixture",
        generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 3_000_000,
        shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
        regions: [{
          id: "face-1", kind: "face", range: { startUs: 0, endUs: 3_000_000 }, confidence: 0.95,
          provenance: { detector: "fixture", modelVersion: "fixture-1" },
          keyframes: [
            { atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 },
            { atUs: 2_999_999, box: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 },
          ],
        }],
      },
    }),
    (error: unknown) => error instanceof Hve5PlanNotExecutableError && error.code === "HVE6_DENSE_PERCEPTION_REQUIRED",
  );
});

test("HVE-6 accepts only dense evidence that covers the complete gameplay clip", async () => {
  const document = documentFixture();
  document.layout[0]!.template = "gameplay_facecam";
  document.layout[0]!.slots = buildUserVerifiedScreenCompositeSlots(document, {
    template: "gameplay_facecam",
    screenCrop: { x: 0, y: 0.25, width: 1, height: 0.75 },
    faceTrackId: "face-1",
  });
  const context = {
    analysisId: ids.analysis,
    source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    faceEvidence: { density: "dense" as const, coverage: [{ startUs: 0, endUs: 2_500_000 }] },
    graph: {
      schemaVersion: 1 as const, sourceId: ids.source, sourceHash: "a".repeat(64), engineVersion: "fixture",
      generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 3_000_000,
      shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
      regions: [{
        id: "face-1", kind: "face" as const, range: { startUs: 0, endUs: 3_000_000 }, confidence: 0.95,
        provenance: { detector: "fixture", modelVersion: "fixture-1" },
        keyframes: [
          { atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 },
          { atUs: 2_999_999, box: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 },
        ],
      }],
    },
  };
  await assert.rejects(
    () => resolveHve5ExecutionPlan(document, [], context),
    (error: unknown) => error instanceof Hve5PlanNotExecutableError && error.code === "HVE6_DENSE_PERCEPTION_COVERAGE_INSUFFICIENT",
  );
  context.faceEvidence.coverage = [{ startUs: 0, endUs: 3_000_000 }];
  const plan = await resolveHve5ExecutionPlan(document, [], context);
  assert.equal(plan.resolvedPlan.layoutSegments[0]?.slots.length, 2);
  assert.equal(plan.resolvedPlan.layoutSegments[0]?.slots[0]?.source.trackId, "source-facecam");
});

test("HVE-6 rejects a dense pass when the chosen face track itself leaves before the clip ends", async () => {
  const document = documentFixture();
  document.layout[0]!.template = "gameplay_facecam";
  document.layout[0]!.slots = buildUserVerifiedScreenCompositeSlots(document, {
    template: "gameplay_facecam",
    screenCrop: { x: 0, y: 0.25, width: 1, height: 0.75 },
    faceTrackId: "face-1",
  });
  await assert.rejects(
    () => resolveHve5ExecutionPlan(document, [], {
      analysisId: ids.analysis,
      source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
      faceEvidence: { density: "dense", coverage: [{ startUs: 0, endUs: 3_000_000 }] },
      graph: {
        schemaVersion: 1 as const, sourceId: ids.source, sourceHash: "a".repeat(64), engineVersion: "fixture",
        generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 3_000_000,
        shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
        regions: [{
          id: "face-1", kind: "face" as const, range: { startUs: 0, endUs: 2_400_000 }, confidence: 0.95,
          provenance: { detector: "fixture", modelVersion: "fixture-1" },
          keyframes: [
            { atUs: 0, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 },
            { atUs: 2_399_999, box: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.95 },
          ],
        }],
      },
    }),
    (error: unknown) => error instanceof Hve5PlanNotExecutableError && error.code === "HVE6_FACE_TRACK_COVERAGE_INSUFFICIENT",
  );
});

test("HVE-6 keeps a user-verified three-person grid behind exact dense evidence", async () => {
  const document = documentFixture();
  document.layout[0]!.template = "grid_3";
  document.layout[0]!.slots = buildUserVerifiedFaceGridSlots(document, {
    template: "grid_3",
    faceTrackIds: ["face-1", "face-2", "face-3"],
  });
  const graph = {
    schemaVersion: 1 as const, sourceId: ids.source, sourceHash: "a".repeat(64), engineVersion: "fixture",
    generatedAt: "2026-08-03T00:00:00.000Z", durationUs: 3_000_000,
    shots: [], speakerTurns: [], activeSpeakerLinks: [], classifications: [], warnings: [],
    regions: ["face-1", "face-2", "face-3"].map((id, index) => ({
      id, kind: "face" as const, range: { startUs: 0, endUs: 3_000_000 }, confidence: 0.95,
      provenance: { detector: "fixture", modelVersion: "fixture-1" },
      keyframes: [
        { atUs: 0, box: { x: index * 0.2, y: 0.1, width: 0.2, height: 0.3 }, confidence: 0.95 },
        { atUs: 2_999_999, box: { x: index * 0.2, y: 0.1, width: 0.2, height: 0.3 }, confidence: 0.95 },
      ],
    })),
  };
  await assert.rejects(
    () => resolveHve5ExecutionPlan(document, [], {
      analysisId: ids.analysis,
      source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
      graph,
    }),
    (error: unknown) => error instanceof Hve5PlanNotExecutableError && error.code === "HVE6_DENSE_PERCEPTION_REQUIRED",
  );
  const plan = await resolveHve5ExecutionPlan(document, [], {
    analysisId: ids.analysis,
    source: { sourceId: ids.source, sourceHash: "a".repeat(64), width: 1920, height: 1080 },
    faceEvidence: { density: "dense", coverage: [{ startUs: 0, endUs: 3_000_000 }] },
    graph,
  });
  assert.equal(plan.resolvedPlan.layoutSegments[0]?.slots.length, 3);
  assert.deepEqual(plan.resolvedPlan.layoutSegments[0]?.slots.map((slot) => slot.source.trackId), [
    "source-face-1", "source-face-2", "source-face-3",
  ]);
});
