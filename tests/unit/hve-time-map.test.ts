import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptionPlan,
  captionPlanToAssCues,
  buildTimeMap,
  captionPlanToSrt,
  captionPlanToVtt,
  derivePauseRemovals,
  deriveTextCutRemovals,
  mapSourceRangeToOutput,
  timeMapSchema,
} from "../../packages/contracts/src/index.js";
import { planHve2Timing } from "../../services/control-api/src/services/hve/timing-planner.js";

const sourceId = "00000000-0000-4000-8000-000000000001";
const segmentId = "00000000-0000-4000-8000-000000000002";

const track = {
  enabled: true,
  language: "ru",
  words: [],
  style: {
    preset: "active_word" as const,
    fontFamily: "HVE Sans",
    fontSizePx: 54,
    fontWeight: 700,
    uppercase: false,
    maxWordsPerLine: 2,
    maxLines: 2,
    position: "bottom" as const,
    safeMarginPx: 120,
    color: "#ffffff",
    activeColor: "#10b8f4",
    outlineColor: "#06131a",
    outlinePx: 4,
    background: false,
  },
};

function mapWithRemovedMiddle() {
  return buildTimeMap({
    narrative: [{
      id: segmentId,
      sourceId,
      sourceRange: { startUs: 0, endUs: 10_000_000 },
      enabled: true,
      order: 0,
      transcriptWordIds: [],
      transitionIn: "cut" as const,
      transitionOut: "cut" as const,
    }],
    removals: [{ sourceId, sourceRange: { startUs: 3_000_000, endUs: 5_000_000 }, reason: "pause" as const }],
  });
}

test("HVE time map removes source-time pauses and produces a contiguous output clock", () => {
  const map = mapWithRemovedMiddle();
  assert.deepEqual(map, [
    { sourceId, sourceRange: { startUs: 0, endUs: 3_000_000 }, outputRange: { startUs: 0, endUs: 3_000_000 }, rate: { numerator: 1, denominator: 1 } },
    { sourceId, sourceRange: { startUs: 5_000_000, endUs: 10_000_000 }, outputRange: { startUs: 3_000_000, endUs: 8_000_000 }, rate: { numerator: 1, denominator: 1 } },
  ]);
});

test("pause crossfade is explicit in the shared output clock and shortens final duration once", () => {
  const map = buildTimeMap({
    narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 10_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
    removals: [{ sourceId, sourceRange: { startUs: 3_000_000, endUs: 5_000_000 }, reason: "pause" }],
    crossfadeUs: 200_000,
  });
  assert.deepEqual(map, [
    { sourceId, sourceRange: { startUs: 0, endUs: 3_000_000 }, outputRange: { startUs: 0, endUs: 3_000_000 }, rate: { numerator: 1, denominator: 1 } },
    { sourceId, sourceRange: { startUs: 5_000_000, endUs: 10_000_000 }, outputRange: { startUs: 2_800_000, endUs: 7_800_000 }, rate: { numerator: 1, denominator: 1 }, transitionInUs: 200_000 },
  ]);
  assert.equal(map.at(-1)?.outputRange.endUs, 7_800_000);
});

test("crossfade is never implied for a user media cut", () => {
  const map = buildTimeMap({
    narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 10_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
    removals: [{ sourceId, sourceRange: { startUs: 3_000_000, endUs: 5_000_000 }, reason: "user" }],
    crossfadeUs: 200_000,
  });
  assert.equal(map[1]?.transitionInUs, undefined);
  assert.deepEqual(map[1]?.outputRange, { startUs: 3_000_000, endUs: 8_000_000 });
});

test("source ranges map to output after a removed interval without floating point time", () => {
  const mapped = mapSourceRangeToOutput(mapWithRemovedMiddle(), sourceId, { startUs: 6_000_000, endUs: 7_000_000 });
  assert.deepEqual(mapped, [{
    sourceRange: { startUs: 6_000_000, endUs: 7_000_000 },
    outputRange: { startUs: 4_000_000, endUs: 5_000_000 },
  }]);
});

test("overlapping removals are normalized and output remains gap-free for every deterministic case", () => {
  const cases = [
    [] as Array<[number, number]>,
    [[0, 1]],
    [[2, 5], [4, 7]],
    [[1, 2], [4, 5], [7, 9]],
    [[0, 10]],
  ];
  for (const ranges of cases) {
    if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === 10) {
      assert.throws(() => buildTimeMap({
        narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 10 }, enabled: true, order: 0, transcriptWordIds: [] }],
        removals: ranges.map(([startUs, endUs]) => ({ sourceId, sourceRange: { startUs, endUs }, reason: "pause" as const })),
      }), /ALL_NARRATIVE_REMOVED/);
      continue;
    }
    const map = buildTimeMap({
      narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 10 }, enabled: true, order: 0, transcriptWordIds: [] }],
      removals: ranges.map(([startUs, endUs]) => ({ sourceId, sourceRange: { startUs, endUs }, reason: "pause" as const })),
    });
    assert.equal(map[0].outputRange.startUs, 0);
    for (let index = 1; index < map.length; index += 1) {
      assert.equal(map[index - 1].outputRange.endUs, map[index].outputRange.startUs);
    }
    assert.equal(
      map.reduce((sum, entry) => sum + (entry.outputRange.endUs - entry.outputRange.startUs), 0),
      map.reduce((sum, entry) => sum + (entry.sourceRange.endUs - entry.sourceRange.startUs), 0),
    );
  }
});

test("time map schema rejects gaps and fractional-duration mappings", () => {
  assert.throws(() => timeMapSchema.parse([
    { sourceId, sourceRange: { startUs: 0, endUs: 10 }, outputRange: { startUs: 1, endUs: 11 }, rate: { numerator: 1, denominator: 1 } },
  ]));
  assert.throws(() => timeMapSchema.parse([
    { sourceId, sourceRange: { startUs: 0, endUs: 10 }, outputRange: { startUs: 0, endUs: 4 }, rate: { numerator: 3, denominator: 1 } },
  ]));
  assert.throws(() => timeMapSchema.parse([
    { sourceId, sourceRange: { startUs: 0, endUs: 10 }, outputRange: { startUs: 0, endUs: 10 }, rate: { numerator: 1, denominator: 1 } },
    { sourceId, sourceRange: { startUs: 20, endUs: 30 }, outputRange: { startUs: 8, endUs: 18 }, rate: { numerator: 1, denominator: 1 } },
  ]));
  assert.doesNotThrow(() => timeMapSchema.parse([
    { sourceId, sourceRange: { startUs: 0, endUs: 10 }, outputRange: { startUs: 0, endUs: 10 }, rate: { numerator: 1, denominator: 1 } },
    { sourceId, sourceRange: { startUs: 20, endUs: 30 }, outputRange: { startUs: 8, endUs: 18 }, rate: { numerator: 1, denominator: 1 }, transitionInUs: 2 },
  ]));
});

test("pause derivation preserves padding around words and never cuts inside known speech", () => {
  const pauses = derivePauseRemovals([
    { wordId: "w1", sourceId, sourceRange: { startUs: 1_000_000, endUs: 1_300_000 }, text: "один" },
    { wordId: "w2", sourceId, sourceRange: { startUs: 3_000_000, endUs: 3_200_000 }, text: "два" },
    { wordId: "w3", sourceId, sourceRange: { startUs: 3_500_000, endUs: 3_700_000 }, text: "три" },
  ], { enabled: true, minimumUs: 1_000_000, beforePaddingUs: 100_000, afterPaddingUs: 120_000 });
  assert.deepEqual(pauses, [{
    sourceId,
    sourceRange: { startUs: 1_420_000, endUs: 2_900_000 },
    reason: "pause",
  }]);
});

test("a cut-from-media transcript edit becomes a source-time removal, not only a hidden subtitle", () => {
  const words = [
    { wordId: "w1", sourceId, sourceRange: { startUs: 1_000_000, endUs: 1_300_000 }, text: "вырезать" },
  ];
  const removals = deriveTextCutRemovals(words, { ...track, words: [{ wordId: "w1", hidden: true, cutFromMedia: true }] });
  assert.deepEqual(removals, [{ sourceId, sourceRange: { startUs: 1_000_000, endUs: 1_300_000 }, reason: "user" }]);
});

test("caption planner follows the same time map, hides removed words, and respects explicit overrides", () => {
  const plan = buildCaptionPlan({
    timeMap: mapWithRemovedMiddle(),
    transcriptWords: [
      { wordId: "w1", sourceId, sourceRange: { startUs: 1_000_000, endUs: 1_400_000 }, text: "Первое" },
      { wordId: "w2", sourceId, sourceRange: { startUs: 2_000_000, endUs: 2_400_000 }, text: "слово" },
      { wordId: "w3", sourceId, sourceRange: { startUs: 3_100_000, endUs: 3_400_000 }, text: "пауза" },
      { wordId: "w4", sourceId, sourceRange: { startUs: 6_000_000, endUs: 6_500_000 }, text: "потом" },
    ],
    track: { ...track, words: [
      { wordId: "w2", displayText: "термин", hidden: false, cutFromMedia: false },
      { wordId: "w4", hidden: true, cutFromMedia: false },
    ] },
  });
  assert.deepEqual(plan.cues, [{
    outputRange: { startUs: 1_000_000, endUs: 2_400_000 },
    lines: ["Первое термин"],
    activeWordIds: ["w1", "w2"],
    words: [
      { wordId: "w1", text: "Первое", outputRange: { startUs: 1_000_000, endUs: 1_400_000 } },
      { wordId: "w2", text: "термин", outputRange: { startUs: 2_000_000, endUs: 2_400_000 } },
    ],
  }]);
  assert.equal(plan.warnings[0]?.code, "HVE_CAPTION_WORD_CUT");
});

test("caption planner does not merge words that overlap during a shared crossfade", () => {
  const timeMap = buildTimeMap({
    narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 7_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
    removals: [{ sourceId, sourceRange: { startUs: 3_000_000, endUs: 5_000_000 }, reason: "pause" }],
    crossfadeUs: 200_000,
  });
  const plan = buildCaptionPlan({
    timeMap,
    transcriptWords: [
      { wordId: "before", sourceId, sourceRange: { startUs: 2_500_000, endUs: 2_900_000 }, text: "до" },
      { wordId: "after", sourceId, sourceRange: { startUs: 5_000_000, endUs: 5_400_000 }, text: "после" },
    ],
    track,
  });
  assert.equal(plan.cues.length, 2);
  assert.deepEqual(plan.cues.map((cue) => cue.outputRange), [
    { startUs: 2_500_000, endUs: 2_900_000 },
    { startUs: 2_800_000, endUs: 3_200_000 },
  ]);
});

test("SRT and VTT serialization use correct independent timestamp formats", () => {
  const plan = buildCaptionPlan({
    timeMap: mapWithRemovedMiddle(),
    transcriptWords: [{ wordId: "w1", sourceId, sourceRange: { startUs: 6_000_000, endUs: 6_500_000 }, text: "Готово" }],
    track,
  });
  assert.equal(captionPlanToSrt(plan), "1\n00:00:04,000 --> 00:00:04,500\nГотово\n");
  assert.equal(captionPlanToVtt(plan), "WEBVTT\n\n00:00:04.000 --> 00:00:04.500\nГотово\n");
});

test("ASS adapter retains planner word timings instead of rebuilding them from cue text", () => {
  const plan = buildCaptionPlan({
    timeMap: buildTimeMap({
      narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 2_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
      removals: [],
    }),
    transcriptWords: [{ wordId: "w1", sourceId, sourceRange: { startUs: 100_100, endUs: 200_100 }, text: "точно", speakerId: "speaker-a" }],
    track,
  });
  assert.deepEqual(captionPlanToAssCues(plan), [{
    id: "hve2-cue-1",
    text: "точно",
    startMs: 100,
    endMs: 201,
    speakerId: "speaker-a",
    words: [{ id: "w1", text: "точно", startMs: 100, endMs: 201, speakerId: "speaker-a" }],
  }]);
});

test("caption planner never exceeds configured line and cue limits", () => {
  const plan = buildCaptionPlan({
    timeMap: buildTimeMap({
      narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 8_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
      removals: [],
    }),
    transcriptWords: Array.from({ length: 9 }, (_, index) => ({
      wordId: `word-${index}`,
      sourceId,
      sourceRange: { startUs: index * 500_000, endUs: index * 500_000 + 300_000 },
      text: `w${index}`,
    })),
    track: { ...track, style: { ...track.style, maxWordsPerLine: 2, maxLines: 2 } },
  });
  assert.equal(plan.cues.length, 3);
  assert.ok(plan.cues.every((cue) => cue.lines.length <= 2));
  assert.ok(plan.cues.every((cue) => cue.words.length <= 4));
});

test("HVE timing facade gives audio and captions the exact same output clock", () => {
  const document = {
    schemaVersion: 2 as const,
    clipId: "00000000-0000-4000-8000-000000000003",
    sourceRefs: [{ sourceId, sourceHash: "a".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000 as const, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 8_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
    layout: [{
      id: "00000000-0000-4000-8000-000000000004",
      anchor: { start: { kind: "clip_start" as const }, end: { kind: "clip_end" as const, offsetUs: 0 } },
      template: "fill",
      slots: [{ slotId: "primary", regionRef: { analysisId: "00000000-0000-4000-8000-000000000005", trackId: "source", kind: "source" as const }, fit: "cover" as const }],
      provenance: { origin: "engine" as const, reasonCode: "TEST" },
      lockedByUser: false,
    }],
    captions: track,
    layers: [],
    audio: {
      sourceCuts: [{ sourceId, sourceRange: { startUs: 2_000_000, endUs: 3_000_000 }, reason: "pause" as const }],
      pauseRemoval: { enabled: true, minimumUs: 800_000, beforePaddingUs: 100_000, afterPaddingUs: 100_000, crossfadeUs: 30_000 },
      loudness: { targetLufs: -16, truePeakDb: -1 },
    },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264" as const, audioCodec: "aac" as const, videoBitrateKbps: 6500, audioBitrateKbps: 160, watermark: false },
    styleVersionId: "00000000-0000-4000-8000-000000000006",
    analysisId: "00000000-0000-4000-8000-000000000007",
    plannerVersion: "test", rendererVersion: "test",
  };
  const result = planHve2Timing(document, [{
    wordId: "w", sourceId, sourceRange: { startUs: 5_000_000, endUs: 5_400_000 }, text: "синхронно",
  }]);
  assert.deepEqual(result.audio.timeMap, result.timeMap);
  assert.deepEqual(result.captions.cues[0].outputRange, { startUs: 3_970_000, endUs: 4_370_000 });
  assert.equal(result.timeMap[1]?.transitionInUs, 30_000);
});

test("HVE timing facade applies a text cut to audio/video time and captions together", () => {
  const document = {
    schemaVersion: 2 as const,
    clipId: "00000000-0000-4000-8000-000000000013",
    sourceRefs: [{ sourceId, sourceHash: "b".repeat(64) }],
    timebase: { ticksPerSecond: 1_000_000 as const, frameRate: { numerator: 30, denominator: 1 } },
    narrative: [{ id: segmentId, sourceId, sourceRange: { startUs: 0, endUs: 4_000_000 }, enabled: true, order: 0, transcriptWordIds: [] }],
    layout: [{ id: "00000000-0000-4000-8000-000000000014", anchor: { start: { kind: "clip_start" as const }, end: { kind: "clip_end" as const, offsetUs: 0 } }, template: "fill", slots: [{ slotId: "primary", regionRef: { analysisId: "00000000-0000-4000-8000-000000000015", trackId: "source", kind: "source" as const }, fit: "cover" as const }], provenance: { origin: "engine" as const, reasonCode: "TEST" }, lockedByUser: false }],
    captions: { ...track, words: [{ wordId: "cut", hidden: true, cutFromMedia: true }] },
    layers: [],
    audio: { sourceCuts: [], pauseRemoval: { enabled: false, minimumUs: 800_000, beforePaddingUs: 100_000, afterPaddingUs: 100_000, crossfadeUs: 30_000 }, loudness: { targetLufs: -16, truePeakDb: -1 } },
    export: { width: 1080, height: 1920, fps: 30, videoCodec: "h264" as const, audioCodec: "aac" as const, videoBitrateKbps: 6500, audioBitrateKbps: 160, watermark: false },
    styleVersionId: "00000000-0000-4000-8000-000000000016", analysisId: "00000000-0000-4000-8000-000000000017", plannerVersion: "test", rendererVersion: "test",
  };
  const result = planHve2Timing(document, [{ wordId: "cut", sourceId, sourceRange: { startUs: 1_000_000, endUs: 1_300_000 }, text: "убрать" }]);
  assert.deepEqual(result.timeMap.map((entry) => entry.outputRange), [{ startUs: 0, endUs: 1_000_000 }, { startUs: 1_000_000, endUs: 3_700_000 }]);
  assert.equal(result.captions.cues.length, 0);
});
