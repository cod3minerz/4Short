import assert from "node:assert/strict";
import test from "node:test";
import {
  hveSequenceDurationUs,
  resolveHveSequenceFrame,
  resolveHveSequencePoint,
  resolveHveSequenceStep,
  type TimeMapEntry,
} from "../../packages/contracts/src/index.js";

const sourceId = "11111111-1111-4111-8111-111111111111";

const timeMap: TimeMapEntry[] = [
  {
    sourceId,
    sourceRange: { startUs: 0, endUs: 1_000_000 },
    outputRange: { startUs: 0, endUs: 1_000_000 },
    rate: { numerator: 1, denominator: 1 },
  },
  {
    sourceId,
    sourceRange: { startUs: 2_000_000, endUs: 3_000_000 },
    outputRange: { startUs: 1_000_000, endUs: 2_000_000 },
    rate: { numerator: 1, denominator: 1 },
  },
];

test("sequence clock uses HVE output time and never shows a phantom end frame", () => {
  assert.equal(hveSequenceDurationUs(timeMap), 2_000_000);
  assert.deepEqual(resolveHveSequencePoint(timeMap, 1_500_000), {
    entryIndex: 1,
    outputUs: 1_500_000,
    sourceId,
    sourceUs: 2_500_000,
    sourceRate: { numerator: 1, denominator: 1 },
    playbackRate: 1,
  });
  assert.equal(resolveHveSequencePoint(timeMap, 2_000_000), null);
});

test("sequence clock seeks across removed source intervals but not during continuous playback", () => {
  const first = resolveHveSequencePoint(timeMap, 900_000);
  assert.ok(first);
  assert.deepEqual(resolveHveSequenceStep({
    timeMap,
    outputUs: 950_000,
    previous: first,
    observedSourceUs: 950_000,
  }), {
    kind: "continue",
    point: resolveHveSequencePoint(timeMap, 950_000),
  });
  const discontinuity = resolveHveSequenceStep({
    timeMap,
    outputUs: 1_000_000,
    previous: first,
    observedSourceUs: 1_000_000,
  });
  assert.equal(discontinuity.kind, "seek");
  if (discontinuity.kind === "seek") {
    assert.equal(discontinuity.reason, "source_discontinuity");
    assert.equal(discontinuity.point.sourceUs, 2_000_000);
  }
});

test("sequence clock makes an initial seek and corrects material native-clock drift", () => {
  const initial = resolveHveSequenceStep({ timeMap, outputUs: 100_000 });
  assert.equal(initial.kind, "seek");
  if (initial.kind === "seek") assert.equal(initial.reason, "initial");

  const previous = resolveHveSequencePoint(timeMap, 200_000);
  assert.ok(previous);
  const drift = resolveHveSequenceStep({
    timeMap,
    outputUs: 400_000,
    previous,
    observedSourceUs: 800_000,
    seekToleranceUs: 100_000,
  });
  assert.equal(drift.kind, "seek");
  if (drift.kind === "seek") assert.equal(drift.reason, "clock_drift");
});

test("sequence clock exposes both source instants during an explicit pause crossfade", () => {
  const crossfadeMap: TimeMapEntry[] = [
    timeMap[0]!,
    {
      ...timeMap[1]!,
      outputRange: { startUs: 900_000, endUs: 1_900_000 },
      transitionInUs: 100_000,
    },
  ];
  const frame = resolveHveSequenceFrame(crossfadeMap, 950_000);
  assert.deepEqual(frame, {
    kind: "crossfade",
    from: {
      entryIndex: 0,
      outputUs: 950_000,
      sourceId,
      sourceUs: 950_000,
      sourceRate: { numerator: 1, denominator: 1 },
      playbackRate: 1,
    },
    to: {
      entryIndex: 1,
      outputUs: 950_000,
      sourceId,
      sourceUs: 2_050_000,
      sourceRate: { numerator: 1, denominator: 1 },
      playbackRate: 1,
    },
    progress: 0.5,
  });
  assert.deepEqual(resolveHveSequenceFrame(crossfadeMap, 1_050_000), {
    kind: "single",
    point: resolveHveSequencePoint(crossfadeMap, 1_050_000),
  });
});
