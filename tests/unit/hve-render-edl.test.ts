import assert from "node:assert/strict";
import test from "node:test";
import { clipDocumentV2Schema, clipEdlSchema } from "../../packages/contracts/src/index.js";
import { materializeHveRenderEdl } from "../../services/control-api/src/services/hve/render-edl.js";

const ids = {
  clip: "10000000-0000-4000-8000-000000000021",
  source: "20000000-0000-4000-8000-000000000021",
  style: "30000000-0000-4000-8000-000000000021",
  analysis: "40000000-0000-4000-8000-000000000021",
  narrative: "50000000-0000-4000-8000-000000000021",
  layout: "60000000-0000-4000-8000-000000000021",
  legacyFont: "70000000-0000-4000-8000-000000000021",
};

function baseEdl() {
  return clipEdlSchema.parse({
    schemaVersion: 1,
    sourceId: ids.source,
    sourceHash: "a".repeat(64),
    range: { startMs: 0, endMs: 3_000 },
    layout: { mode: "auto" },
    subtitles: {
      enabled: true, mode: "line", preset: "clean", fontAssetId: ids.legacyFont,
      fontFamily: "Legacy Font", fontSize: 42, fontWeight: 400,
      maxWordsPerLine: 2, maxLines: 1, position: "top", safeMarginPx: 40,
      color: "#101010", activeColor: "#222222", outlineColor: "#333333", outlinePx: 1,
      background: false,
    },
    silence: { enabled: false, minimumMs: 800, beforePaddingMs: 100, afterPaddingMs: 120, crossfadeMs: 0 },
    export: { width: 720, height: 1280, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 2_500, audioBitrateKbps: 96, watermark: true },
    styleVersionId: ids.style,
    rendererVersion: "legacy-renderer",
  });
}

function hveDocument() {
  return clipDocumentV2Schema.parse({
    schemaVersion: 2,
    clipId: ids.clip,
    sourceRefs: [{ sourceId: ids.source, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{
      id: ids.narrative, sourceId: ids.source, sourceRange: { startUs: 0, endUs: 3_000_000 },
      enabled: true, order: 0, transcriptWordIds: [], transitionIn: "cut", transitionOut: "cut",
    }],
    layout: [{
      id: ids.layout,
      anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      template: "fill",
      slots: [{ slotId: "primary", regionRef: { analysisId: ids.analysis, trackId: "source", kind: "source" }, fit: "cover" }],
      provenance: { origin: "engine", reasonCode: "TEST" }, lockedByUser: false,
    }],
    captions: {
      enabled: true, language: "ru", words: [],
      style: {
        preset: "word_pop", fontFamily: "HVE Sans", fontSizePx: 68, fontWeight: 800,
        uppercase: true, maxWordsPerLine: 5, maxLines: 2, position: "bottom", safeMarginPx: 120,
        color: "#ffffff", activeColor: "#10b8f4", outlineColor: "#06131a", outlinePx: 4, background: true,
      },
    },
    layers: [],
    audio: {
      sourceCuts: [],
      pauseRemoval: { enabled: false, minimumUs: 0, beforePaddingUs: 0, afterPaddingUs: 0, crossfadeUs: 0 },
      loudness: { targetLufs: -16, truePeakDb: -1.5 },
    },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac", videoBitrateKbps: 6_500, audioBitrateKbps: 160, watermark: false },
    styleVersionId: ids.style,
    analysisId: ids.analysis,
    plannerVersion: "hve-test", rendererVersion: "hve-renderer-v2-font-pack-1",
  });
}

test("HVE editor commit materializes the immutable subtitle style for the worker envelope", () => {
  const edl = materializeHveRenderEdl(hveDocument(), baseEdl());

  assert.deepEqual(edl.export, {
    width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac",
    videoBitrateKbps: 6_500, audioBitrateKbps: 160, watermark: false,
  });
  assert.deepEqual(edl.subtitles, {
    enabled: true, mode: "word_by_word", preset: "word_pop", fontFamily: "HVE Sans",
    fontSize: 68, fontWeight: 800, uppercase: true, maxWordsPerLine: 5, maxLines: 2,
    position: "bottom", safeMarginPx: 120, align: "center", color: "#ffffff",
    activeColor: "#10b8f4", outlineColor: "#06131a", outlinePx: 4, shadow: true,
    background: true, punctuation: true, emoji: false, censorWords: [],
  });
  assert.equal("fontAssetId" in edl.subtitles, false);
  assert.equal(edl.rendererVersion, "hve-renderer-v2-font-pack-1");
});

test("HVE render envelope maps each timing treatment explicitly", () => {
  const document = hveDocument();
  const expected = new Map([
    ["clean", "line"],
    ["bold", "line"],
    ["minimal_box", "line"],
    ["speaker_colors", "line"],
    ["active_word", "active_word"],
    ["karaoke", "karaoke"],
    ["word_pop", "word_by_word"],
  ] as const);
  for (const [preset, mode] of expected) {
    const current = structuredClone(document);
    current.captions.style.preset = preset;
    const edl = materializeHveRenderEdl(current, baseEdl());
    assert.equal(edl.subtitles.mode, mode, preset);
    assert.equal(edl.subtitles.preset, preset, preset);
  }
});
