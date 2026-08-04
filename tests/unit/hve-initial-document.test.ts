import assert from "node:assert/strict";
import test from "node:test";
import { clipEdlSchema } from "../../packages/contracts/src/index.js";
import { defaultStyleConfig } from "../../packages/product-config/src/index.js";
import { buildInitialHveDocument } from "../../services/control-api/src/services/hve/initial-document.js";

const ids = {
  clip: "10000000-0000-4000-8000-000000000099",
  source: "20000000-0000-4000-8000-000000000099",
  style: "30000000-0000-4000-8000-000000000099",
};

function edl(overrides: Record<string, unknown> = {}) {
  return clipEdlSchema.parse({
    schemaVersion: 1,
    sourceId: ids.source,
    sourceHash: "a".repeat(64),
    range: { startMs: 1_000, endMs: 8_000 },
    cuts: [],
    transcriptEdits: [],
    layout: { mode: "auto", safeFallback: "static_crop" },
    subtitles: defaultStyleConfig.subtitles,
    silence: { ...defaultStyleConfig.silence, crossfadeMs: 0 },
    export: defaultStyleConfig.export,
    styleVersionId: ids.style,
    rendererVersion: "hve-test",
    ...overrides,
  });
}

const words = [
  { wordId: "word-before", sourceId: ids.source, sourceRange: { startUs: 0, endUs: 500_000 }, text: "До" },
  { wordId: "word-one", sourceId: ids.source, sourceRange: { startUs: 1_100_000, endUs: 1_500_000 }, text: "Первое" },
  { wordId: "word-two", sourceId: ids.source, sourceRange: { startUs: 7_000_000, endUs: 7_500_000 }, text: "слово" },
  { wordId: "word-after", sourceId: ids.source, sourceRange: { startUs: 8_000_000, endUs: 8_500_000 }, text: "После" },
];

test("initial HVE document preserves the executable source range and canonical transcript words", () => {
  const result = buildInitialHveDocument({
    clipId: ids.clip,
    edl: edl({ title: { text: "Проверяемый заголовок", startMs: 0, endMs: 7_000, anchor: "top_center", widthPercent: 70, marginPx: 48, opacity: 1, radiusPx: 20, shadow: false, loop: false } }),
    transcriptWords: words,
    plannerVersion: "hve-planner-test",
    rendererVersion: "hve-render-test",
  });
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.equal(result.document.clipId, ids.clip);
  assert.equal(result.document.layout[0]?.template, "portrait_focus");
  assert.deepEqual(result.document.narrative[0]?.sourceRange, { startUs: 1_000_000, endUs: 8_000_000 });
  assert.deepEqual(result.document.narrative[0]?.transcriptWordIds, ["word-one", "word-two"]);
  assert.deepEqual(result.document.captions.words.map((word) => word.wordId), ["word-one", "word-two"]);
  assert.equal(result.document.layers[0]?.type, "text");
  assert.equal(result.document.audio.pauseRemoval.crossfadeUs, 0);
});

test("initial HVE document freezes transcript caption and media-cut overrides", () => {
  const result = buildInitialHveDocument({
    clipId: ids.clip,
    edl: edl(),
    transcriptWords: words,
    captionOverrides: [
      { wordId: "word-one", displayText: "Исправленное", hidden: false, cutFromMedia: false },
      { wordId: "word-two", hidden: true, cutFromMedia: true },
      // An override outside the clip range cannot leak into this immutable
      // clip document.
      { wordId: "word-before", hidden: true, cutFromMedia: true },
    ],
    plannerVersion: "hve-planner-test",
    rendererVersion: "hve-render-test",
  });
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.deepEqual(result.document.captions.words, [
    { wordId: "word-one", displayText: "Исправленное", hidden: false, cutFromMedia: false },
    { wordId: "word-two", hidden: true, cutFromMedia: true },
  ]);
});

test("clip-specific transcript edits refine a snapshot without reviving a source media cut", () => {
  const result = buildInitialHveDocument({
    clipId: ids.clip,
    edl: edl({ transcriptEdits: [
      { wordRef: "word-one", displayText: "Только для клипа", hiddenFromSubtitles: false, cutFromMedia: false },
      { wordRef: "word-two", hiddenFromSubtitles: false, cutFromMedia: false },
    ] }),
    transcriptWords: words,
    captionOverrides: [
      { wordId: "word-one", displayText: "Из проекта", hidden: false, cutFromMedia: false },
      { wordId: "word-two", hidden: true, cutFromMedia: true },
    ],
    plannerVersion: "hve-planner-test",
    rendererVersion: "hve-render-test",
  });
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.deepEqual(result.document.captions.words, [
    { wordId: "word-one", displayText: "Только для клипа", hidden: false, cutFromMedia: false },
    { wordId: "word-two", hidden: true, cutFromMedia: true },
  ]);
});

test("initial HVE document declines a layout that needs visual evidence instead of silently centre-cropping", () => {
  const result = buildInitialHveDocument({
    clipId: ids.clip,
    edl: edl({ layout: { mode: "screen_gameplay", facePosition: "top" } }),
    transcriptWords: words,
    plannerVersion: "hve-planner-test",
    rendererVersion: "hve-render-test",
  });
  assert.deepEqual(result, { supported: false, reason: "HVE_INITIAL_LAYOUT_EVIDENCE_REQUIRED" });
});

test("initial HVE document preserves a legacy crossfade for the shared HVE time map", () => {
  const result = buildInitialHveDocument({
    clipId: ids.clip,
    edl: edl({ silence: { ...defaultStyleConfig.silence, crossfadeMs: 30 } }),
    transcriptWords: words,
    plannerVersion: "hve-planner-test",
    rendererVersion: "hve-render-test",
  });
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.equal(result.document.audio.pauseRemoval.crossfadeUs, 30_000);
});

test("initial HVE document keeps an existing non-HVE font on the v1 renderer", () => {
  const result = buildInitialHveDocument({
    clipId: ids.clip,
    edl: edl({ subtitles: { ...defaultStyleConfig.subtitles, fontFamily: "Manrope" } }),
    transcriptWords: words,
    plannerVersion: "hve-planner-test",
    rendererVersion: "hve-render-test",
  });
  assert.deepEqual(result, { supported: false, reason: "HVE_INITIAL_FONT_UNSUPPORTED" });
});
