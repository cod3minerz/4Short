import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEditorCommandBatchSchema,
  applyEditorDraftCommands,
  applyEditorCommands,
  clipDocumentV2Schema,
  editorCommandSchema,
  HveEditorCommandError,
  type ClipDocumentV2,
  type EditorCommand,
} from "../../packages/contracts/src/index.js";

const ids = {
  clip: "11111111-1111-4111-8111-111111111111",
  source: "22222222-2222-4222-8222-222222222222",
  analysis: "33333333-3333-4333-8333-333333333333",
  style: "44444444-4444-4444-8444-444444444444",
  narrativeA: "55555555-5555-4555-8555-555555555555",
  narrativeB: "66666666-6666-4666-8666-666666666666",
  layout: "77777777-7777-4777-8777-777777777777",
  denseAnalysis: "88888888-8888-4888-8888-888888888888",
  layer: "99999999-9999-4999-8999-999999999999",
};

function documentFixture(): ClipDocumentV2 {
  return clipDocumentV2Schema.parse({
    schemaVersion: 2,
    clipId: ids.clip,
    sourceRefs: [{ sourceId: ids.source, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [
      { id: ids.narrativeA, sourceId: ids.source, sourceRange: { startUs: 0, endUs: 2_000_000 }, enabled: true, order: 0, transcriptWordIds: ["w1", "w2"] },
      { id: ids.narrativeB, sourceId: ids.source, sourceRange: { startUs: 3_000_000, endUs: 5_000_000 }, enabled: true, order: 1, transcriptWordIds: ["w3"] },
    ],
    layout: [{
      id: ids.layout,
      anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      template: "portrait_focus",
      slots: [{ slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "source", kind: "source" }, fit: "cover" }],
      provenance: { origin: "engine", reasonCode: "TEST" }, lockedByUser: false,
    }],
    captions: {
      enabled: true, language: "ru", words: [
        { wordId: "w1", hidden: false, cutFromMedia: false },
        { wordId: "w2", hidden: false, cutFromMedia: false },
        { wordId: "w3", hidden: false, cutFromMedia: false },
      ],
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
    styleVersionId: ids.style, analysisId: ids.analysis, plannerVersion: "unit", rendererVersion: "unit",
  });
}

let sequence = 0;
function command(payload: Record<string, unknown>): EditorCommand {
  sequence += 1;
  return editorCommandSchema.parse({
    commandId: `90000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clipId: ids.clip,
    clientId: "unit-test",
    clientSequence: sequence,
    baseRevision: 0,
    createdAt: "2026-08-03T00:00:00.000Z",
    ...payload,
  });
}

test("text changes and media cuts remain separate, typed draft intents", () => {
  const result = applyEditorCommands(documentFixture(), [
    command({ kind: "replace_word", wordId: "w1", displayText: "исправлено" }),
    command({ kind: "set_word_visibility", wordIds: ["w2"], hidden: true }),
    command({ kind: "cut_words", wordIds: ["w3"], cut: true }),
  ]);
  assert.deepEqual(result.captions.words, [
    { wordId: "w1", hidden: false, cutFromMedia: false, displayText: "исправлено" },
    { wordId: "w2", hidden: true, cutFromMedia: false },
    { wordId: "w3", hidden: false, cutFromMedia: true },
  ]);
});

test("trim cannot extend a narrative range beyond its original source interval", () => {
  assert.throws(
    () => applyEditorCommands(documentFixture(), [command({
      kind: "trim_narrative", segmentId: ids.narrativeA, sourceRange: { startUs: 0, endUs: 2_100_000 },
    })]),
    (error: unknown) => error instanceof HveEditorCommandError && error.code === "HVE_EDITOR_TRIM_OUTSIDE_SEGMENT",
  );
});

test("reorder is complete and deterministic rather than a partial move", () => {
  const result = applyEditorCommands(documentFixture(), [command({
    kind: "reorder_narrative", orderedSegmentIds: [ids.narrativeB, ids.narrativeA],
  })]);
  assert.deepEqual(result.narrative.map((segment) => [segment.id, segment.order]), [
    [ids.narrativeA, 1], [ids.narrativeB, 0],
  ]);
  assert.throws(
    () => applyEditorCommands(documentFixture(), [command({ kind: "reorder_narrative", orderedSegmentIds: [ids.narrativeA] })]),
    (error: unknown) => error instanceof HveEditorCommandError && error.code === "HVE_EDITOR_REORDER_INCOMPLETE",
  );
});

test("manual crop can be set and removed without serializing an undefined field", () => {
  const edited = applyEditorCommands(documentFixture(), [command({
    kind: "set_manual_crop", layoutSegmentId: ids.layout, slotId: "primary", crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
  })]);
  assert.deepEqual(edited.layout[0]?.slots[0]?.manualCrop, { x: 0.1, y: 0, width: 0.8, height: 1 });
  const restored = applyEditorCommands(edited, [command({
    kind: "set_manual_crop", layoutSegmentId: ids.layout, slotId: "primary", crop: null,
  })]);
  assert.equal("manualCrop" in restored.layout[0]!.slots[0]!, false);
});

test("a selected dense perception track binds every crop reference to one analysis", () => {
  const result = applyEditorCommands(documentFixture(), [command({
    kind: "set_crop_track", layoutSegmentId: ids.layout, slotId: "primary",
    analysisId: ids.denseAnalysis, trackId: "face-2",
  })]);
  assert.equal(result.analysisId, ids.denseAnalysis);
  assert.equal(result.sourceRefs[0]?.analysisId, ids.denseAnalysis);
  assert.deepEqual(result.layout[0]?.slots[0]?.cropTrack, { analysisId: ids.denseAnalysis, trackId: "face-2" });
});

test("a user-verified face grid derives all slots from the canonical document", () => {
  const result = applyEditorCommands(documentFixture(), [command({
    kind: "set_user_verified_face_grid",
    layoutSegmentId: ids.layout,
    template: "grid_3",
    faceTrackIds: ["face-a", "face-b", "face-c"],
  })]);

  const layout = result.layout[0]!;
  assert.equal(layout.template, "grid_3");
  assert.equal(layout.lockedByUser, true);
  assert.deepEqual(layout.provenance, { origin: "user", reasonCode: "EDITOR_USER_VERIFIED_FACE_GRID" });
  assert.deepEqual(layout.slots.map((slot) => ({
    slotId: slot.slotId,
    analysisId: slot.cropTrack?.analysisId,
    trackId: slot.cropTrack?.trackId,
  })), [
    { slotId: "primary", analysisId: ids.analysis, trackId: "face-a" },
    { slotId: "secondary", analysisId: ids.analysis, trackId: "face-b" },
    { slotId: "tertiary", analysisId: ids.analysis, trackId: "face-c" },
  ]);
});

test("a face grid rejects duplicate tracks before an ambiguous draft is saved", () => {
  assert.throws(
    () => applyEditorCommands(documentFixture(), [command({
      kind: "set_user_verified_face_grid",
      layoutSegmentId: ids.layout,
      template: "grid_4",
      faceTrackIds: ["face-a", "face-b", "face-c", "face-a"],
    })]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "HVE6_GRID_TRACKS_INVALID",
  );
});

test("face grid commands have an exact track count in the transport contract", () => {
  const parsed = editorCommandSchema.safeParse({
    commandId: "aaaaaaaa-0000-4000-8000-000000000001",
    batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clipId: ids.clip,
    clientId: "unit-test",
    clientSequence: 1,
    baseRevision: 0,
    createdAt: "2026-08-03T00:00:00.000Z",
    kind: "set_user_verified_face_grid",
    layoutSegmentId: ids.layout,
    template: "grid_3",
    faceTrackIds: ["face-a", "face-b"],
  });
  assert.equal(parsed.success, false);
});

test("a user-verified screen composite derives safe slots instead of accepting a client scene graph", () => {
  const result = applyEditorCommands(documentFixture(), [command({
    kind: "set_user_verified_screen_composite",
    layoutSegmentId: ids.layout,
    template: "gameplay_facecam",
    screenCrop: { x: 0, y: 0.32, width: 1, height: 0.68 },
    faceTrackId: "facecam-track",
  })]);
  const layout = result.layout[0]!;
  assert.equal(layout.template, "gameplay_facecam");
  assert.equal(layout.lockedByUser, true);
  assert.deepEqual(layout.provenance, { origin: "user", reasonCode: "EDITOR_USER_VERIFIED_SCREEN_COMPOSITE" });
  assert.deepEqual(layout.slots.map((slot) => ({
    slotId: slot.slotId,
    fit: slot.fit,
    manualCrop: slot.manualCrop,
    cropTrack: slot.cropTrack,
  })), [
    { slotId: "facecam", fit: "smart_cover", manualCrop: undefined, cropTrack: { analysisId: ids.analysis, trackId: "facecam-track" } },
    { slotId: "gameplay", fit: "contain", manualCrop: { x: 0, y: 0.32, width: 1, height: 0.68 }, cropTrack: undefined },
  ]);
});

test("a command for another clip is rejected before it can modify the draft", () => {
  const invalid = command({ kind: "set_caption_style", patch: { fontSizePx: 56 } });
  invalid.clipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.throws(
    () => applyEditorCommands(documentFixture(), [invalid]),
    (error: unknown) => error instanceof HveEditorCommandError && error.code === "HVE_EDITOR_CLIP_MISMATCH",
  );
});

test("a missing canonical transcript word cannot become a fake editing intent", () => {
  assert.throws(
    () => applyEditorCommands(documentFixture(), [command({
      kind: "replace_word", wordId: "not-in-document", displayText: "не существует",
    })]),
    (error: unknown) => error instanceof HveEditorCommandError && error.code === "HVE_EDITOR_WORD_NOT_FOUND",
  );
});

test("transport batch binds every command to one idempotent revision", () => {
  const first = command({ kind: "set_caption_style", patch: { fontSizePx: 56 } });
  const second = command({ kind: "set_caption_style", patch: { fontWeight: 800 } });
  const accepted = applyEditorCommandBatchSchema.safeParse({
    batchId: first.batchId,
    baseRevision: 0,
    commands: [first, second],
  });
  assert.equal(accepted.success, true);

  const rejected = applyEditorCommandBatchSchema.safeParse({
    batchId: first.batchId,
    baseRevision: 1,
    commands: [first],
  });
  assert.equal(rejected.success, false);
});

test("clip metadata shares a revision with document edits without entering the media document", () => {
  const original = documentFixture();
  const result = applyEditorDraftCommands({
    document: original,
    metadata: { title: "Старый заголовок", socialTitle: null, socialDescription: "Старое описание" },
    commands: [
      command({ kind: "replace_word", wordId: "w1", displayText: "исправлено" }),
      command({ kind: "set_clip_metadata", patch: { title: "Новый заголовок", socialDescription: null } }),
    ],
  });
  assert.equal(result.document.captions.words[0]?.displayText, "исправлено");
  assert.deepEqual(result.metadata, {
    title: "Новый заголовок",
    socialTitle: null,
    socialDescription: null,
  });
  assert.equal("metadata" in result.document, false);
});

test("metadata-only commands are rejected by the document-only reducer", () => {
  assert.throws(
    () => applyEditorCommands(documentFixture(), [command({ kind: "set_clip_metadata", patch: { title: "Новый" } })]),
    (error: unknown) => error instanceof HveEditorCommandError && error.code === "HVE_EDITOR_METADATA_REQUIRES_DRAFT",
  );
});

test("caption visibility is a typed track command, not a style side effect", () => {
  const result = applyEditorCommands(documentFixture(), [command({
    kind: "set_caption_track",
    patch: { enabled: false },
  })]);
  assert.equal(result.captions.enabled, false);
  assert.equal(result.captions.style.preset, "clean");
});

test("a cleared transcript override returns to canonical caption text", () => {
  const overridden = applyEditorCommands(documentFixture(), [command({
    kind: "replace_word", wordId: "w1", displayText: "исправлено",
  })]);
  const result = applyEditorCommands(overridden, [command({
    kind: "clear_word_display", wordId: "w1",
  })]);
  assert.equal("displayText" in result.captions.words[0]!, false);
});

test("a text layer changes through a typed layer command only", () => {
  const document = clipDocumentV2Schema.parse({ ...documentFixture(),
    layers: [{
      id: ids.layer,
      type: "text",
      text: "Старый заголовок",
      styleRef: "hve-title-v1",
      anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      followPolicy: "absolute_output",
      zIndex: 10,
      anchor: "top_center",
      box: { x: 0.08, y: 0.06, width: 0.84, height: 0.17 },
      opacity: 1,
      collisionPolicy: "warn",
    }],
  });
  const next = applyEditorCommands(document, [command({
    kind: "set_text_layer",
    layerId: ids.layer,
    patch: { text: "Новый заголовок", anchor: "bottom_center" },
  })]);
  assert.deepEqual(next.layers[0] && { type: next.layers[0].type, text: next.layers[0].type === "text" ? next.layers[0].text : null, anchor: next.layers[0].anchor }, {
    type: "text", text: "Новый заголовок", anchor: "bottom_center",
  });
});
