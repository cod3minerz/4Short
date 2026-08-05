import assert from "node:assert/strict";
import test from "node:test";
import { clipDocumentV2Schema, type ClipDocumentV2 } from "../../packages/contracts/src/index.js";
import { buildHveDraftSync } from "../../app/dashboard/lib/hve-draft-sync.js";
import type { ClipEditorState } from "../../app/dashboard/types.js";

const ids = {
  clip: "11111111-1111-4111-8111-111111111111",
  source: "22222222-2222-4222-8222-222222222222",
  analysis: "33333333-3333-4333-8333-333333333333",
  style: "44444444-4444-4444-8444-444444444444",
  narrative: "55555555-5555-4555-8555-555555555555",
  layout: "66666666-6666-4666-8666-666666666666",
};

function documentFixture(): ClipDocumentV2 {
  return clipDocumentV2Schema.parse({
    schemaVersion: 2,
    clipId: ids.clip,
    sourceRefs: [{ sourceId: ids.source, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{ id: ids.narrative, sourceId: ids.source, sourceRange: { startUs: 1_000_000, endUs: 5_000_000 }, enabled: true, order: 0, transcriptWordIds: ["w1", "w2"] }],
    layout: [{
      id: ids.layout,
      anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      template: "portrait_focus",
      slots: [{ slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "source", kind: "source" }, fit: "cover" }],
      provenance: { origin: "style", reasonCode: "TEST" }, lockedByUser: false,
    }],
    captions: {
      enabled: true, language: "ru",
      words: [{ wordId: "w1", hidden: false, cutFromMedia: false }, { wordId: "w2", hidden: false, cutFromMedia: false }],
      style: { preset: "clean", fontFamily: "HVE Sans", fontSizePx: 48, fontWeight: 800, uppercase: false, maxWordsPerLine: 5, maxLines: 2, position: "bottom", safeMarginPx: 160, color: "#ffffff", activeColor: "#f2f2ed", outlineColor: "#0a0a0b", outlinePx: 4, background: false },
    },
    layers: [],
    audio: { sourceCuts: [], pauseRemoval: { enabled: false, minimumUs: 800_000, beforePaddingUs: 100_000, afterPaddingUs: 120_000, crossfadeUs: 0 }, loudness: { targetLufs: -16, truePeakDb: -1.5 } },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 6500, audioBitrateKbps: 160, watermark: false },
    styleVersionId: ids.style, analysisId: ids.analysis, plannerVersion: "test", rendererVersion: "test",
  });
}

function stateFixture(): ClipEditorState {
  return {
    title: "Новый заголовок", socialTitle: "Социальный заголовок", socialDescription: "Описание",
    startSeconds: 1, endSeconds: 5, layout: "auto", speaker: "Автоматически",
    captionsEnabled: false, subtitlePreset: "clean", fontFamily: "HVE Sans", fontSize: 48,
    subtitlePosition: "bottom", primaryColor: "#ffffff", activeColor: "#f2f2ed",
    titleEnabled: false, titlePosition: "top", bannerEnabled: false, logoEnabled: false,
    silenceRemoval: true, normalizeAudio: false, exportHeight: 1920,
  };
}

test("HVE draft sync creates only typed, render-safe changes", () => {
  let serial = 0;
  const result = buildHveDraftSync({
    draft: { clipId: ids.clip, revision: 4, document: documentFixture(), metadata: { title: "Старый", socialTitle: null, socialDescription: null } },
    state: stateFixture(),
    words: [
      { id: "w1", segmentId: "segment", wordIndex: 0, word: "старое", speaker: "А", time: "0:01", seconds: 1, endSeconds: 2 },
      { id: "w2", segmentId: "segment", wordIndex: 1, word: "слово", speaker: "А", time: "0:02", seconds: 2, endSeconds: 3 },
    ],
    wordEdits: { w1: "новое" }, hiddenWords: ["w2"], cutWords: [],
    clientId: "unit", firstSequence: 10, batchId: "77777777-7777-4777-8777-777777777777",
    createdAt: "2026-08-03T00:00:00.000Z", createCommandId: () => `90000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
  });
  assert.equal(result.unsupported.length, 0);
  assert.deepEqual(result.commands.map((command) => command.kind), [
    "set_clip_metadata", "set_caption_track", "set_audio_policy", "replace_word", "set_word_visibility",
  ]);
  assert.equal(result.commands.every((command) => command.baseRevision === 4), true);
  assert.equal(result.nextSequence, 15);
});

test("HVE draft sync refuses to pretend an unsupported layout is renderable", () => {
  const state = stateFixture();
  state.layout = "active_speaker";
  const result = buildHveDraftSync({
    draft: { clipId: ids.clip, revision: 0, document: documentFixture(), metadata: { title: "Новый заголовок", socialTitle: "Социальный заголовок", socialDescription: "Описание" } },
    state, words: [], wordEdits: {}, hiddenWords: [], cutWords: [], clientId: "unit", firstSequence: 0,
    batchId: "77777777-7777-4777-8777-777777777777", createdAt: "2026-08-03T00:00:00.000Z",
    createCommandId: () => "90000000-0000-4000-8000-000000000001",
  });
  assert.equal(result.unsupported.some((message) => message.includes("кадра")), true);
});

test("HVE draft sync creates a real title layer rather than metadata-only title text", () => {
  const state = stateFixture();
  state.titleEnabled = true;
  const result = buildHveDraftSync({
    draft: { clipId: ids.clip, revision: 0, document: documentFixture(), metadata: { title: "Новый заголовок", socialTitle: "Социальный заголовок", socialDescription: "Описание" } },
    state, words: [], wordEdits: {}, hiddenWords: [], cutWords: [], clientId: "unit", firstSequence: 0,
    batchId: "77777777-7777-4777-8777-777777777777", createdAt: "2026-08-03T00:00:00.000Z",
    createCommandId: () => "90000000-0000-4000-8000-000000000002",
  });
  const layer = result.commands.find((command) => command.kind === "add_layer");
  assert.equal(layer?.kind, "add_layer");
  assert.equal(layer?.kind === "add_layer" && layer.layer.type === "text" ? layer.layer.text : null, "Новый заголовок");
});
