import { timeMapSchema, type TimeMapEntry } from "./hve-v2.js";

/**
 * Browser-side clock primitives for the native HVE source reviewer.
 *
 * An HTMLVideoElement only understands source time. HVE removes pauses and
 * may join non-adjacent source ranges, so using `video.currentTime` as the
 * editor playhead would make captions, trim and render disagree. These pure
 * helpers translate the immutable worker time map without touching media,
 * DOM state or visual composition.
 */

export const HVE_SEQUENCE_DEFAULT_SEEK_TOLERANCE_US = 120_000;

export type HveSequencePoint = {
  entryIndex: number;
  outputUs: number;
  sourceId: string;
  sourceUs: number;
  /** Source microseconds consumed for one output microsecond. */
  sourceRate: { numerator: number; denominator: number };
  /** Value for HTMLMediaElement.playbackRate where the platform supports it. */
  playbackRate: number;
};

/**
 * One instant of the immutable output clock as it must be presented by a
 * browser reviewer.  A pause crossfade is not a discontinuity that a single
 * media element can faithfully seek through: both source instants are active
 * for its short overlap.  Keeping this fact in contracts prevents the UI
 * from choosing an arbitrary side of an overlapping TimeMap range.
 */
export type HveSequenceFrame =
  | { kind: "single"; point: HveSequencePoint }
  | {
      kind: "crossfade";
      from: HveSequencePoint;
      to: HveSequencePoint;
      /** Normalised 0..1 progress through the explicit output overlap. */
      progress: number;
    };

export type HveSequenceStep =
  | { kind: "ended"; outputUs: number }
  | {
      kind: "continue" | "seek";
      point: HveSequencePoint;
      reason?: "initial" | "source_discontinuity" | "clock_drift";
    };

function normalizedMap(input: TimeMapEntry[]) {
  return timeMapSchema.parse(input);
}

/** Returns the exact output duration without inferring it from source time. */
export function hveSequenceDurationUs(timeMap: TimeMapEntry[]) {
  const map = normalizedMap(timeMap);
  return map.at(-1)!.outputRange.endUs;
}

/**
 * Projects one output instant onto the source media required at that instant.
 * End-of-sequence is intentionally represented as `null`; callers must stop
 * playback instead of seeking a phantom final frame.
 */
export function resolveHveSequencePoint(timeMap: TimeMapEntry[], outputUs: number): HveSequencePoint | null {
  if (!Number.isSafeInteger(outputUs) || outputUs < 0) throw new Error("HVE_SEQUENCE_OUTPUT_TIME_INVALID");
  const map = normalizedMap(timeMap);
  const entryIndex = map.findIndex((entry) => (
    entry.outputRange.startUs <= outputUs && outputUs < entry.outputRange.endUs
  ));
  if (entryIndex < 0) return null;
  const entry = map[entryIndex]!;
  const outputOffsetUs = outputUs - entry.outputRange.startUs;
  const sourceUs = entry.sourceRange.startUs + (outputOffsetUs * entry.rate.numerator) / entry.rate.denominator;
  return {
    entryIndex,
    outputUs,
    sourceId: entry.sourceId,
    sourceUs,
    sourceRate: entry.rate,
    playbackRate: entry.rate.numerator / entry.rate.denominator,
  };
}

function pointForEntry(map: TimeMapEntry[], entryIndex: number, outputUs: number): HveSequencePoint {
  const entry = map[entryIndex];
  if (!entry) throw new Error("HVE_SEQUENCE_ENTRY_INVALID");
  const outputOffsetUs = outputUs - entry.outputRange.startUs;
  return {
    entryIndex,
    outputUs,
    sourceId: entry.sourceId,
    sourceUs: entry.sourceRange.startUs + (outputOffsetUs * entry.rate.numerator) / entry.rate.denominator,
    sourceRate: entry.rate,
    playbackRate: entry.rate.numerator / entry.rate.denominator,
  };
}

/**
 * Resolves every source frame that is visually/audibly active at an output
 * instant.  The TimeMap schema guarantees the transition is fully contained
 * by the preceding entry, so a transition can only ever have two sources.
 */
export function resolveHveSequenceFrame(timeMap: TimeMapEntry[], outputUs: number): HveSequenceFrame | null {
  if (!Number.isSafeInteger(outputUs) || outputUs < 0) throw new Error("HVE_SEQUENCE_OUTPUT_TIME_INVALID");
  const map = normalizedMap(timeMap);
  for (let entryIndex = 1; entryIndex < map.length; entryIndex += 1) {
    const entry = map[entryIndex]!;
    const transitionInUs = entry.transitionInUs ?? 0;
    const previous = map[entryIndex - 1]!;
    if (transitionInUs > 0
      && outputUs >= entry.outputRange.startUs
      && outputUs < previous.outputRange.endUs) {
      return {
        kind: "crossfade",
        from: pointForEntry(map, entryIndex - 1, outputUs),
        to: pointForEntry(map, entryIndex, outputUs),
        progress: (outputUs - entry.outputRange.startUs) / transitionInUs,
      };
    }
  }
  const point = resolveHveSequencePoint(map, outputUs);
  return point ? { kind: "single", point } : null;
}

function isContinuous(previous: HveSequencePoint, next: HveSequencePoint) {
  if (previous.sourceId !== next.sourceId || next.outputUs < previous.outputUs) return false;
  const expectedSourceUs = previous.sourceUs
    + ((next.outputUs - previous.outputUs) * previous.sourceRate.numerator) / previous.sourceRate.denominator;
  return Math.abs(next.sourceUs - expectedSourceUs) < 0.5;
}

/**
 * Decides whether the native source element must seek before showing a new
 * HVE output instant. It does not hide a discontinuity: a removed pause or a
 * newly ordered narrative segment always yields `seek`.
 */
export function resolveHveSequenceStep(input: {
  timeMap: TimeMapEntry[];
  outputUs: number;
  previous?: HveSequencePoint | null;
  observedSourceUs?: number | null;
  seekToleranceUs?: number;
}): HveSequenceStep {
  const point = resolveHveSequencePoint(input.timeMap, input.outputUs);
  if (!point) return { kind: "ended", outputUs: input.outputUs };
  if (!input.previous) return { kind: "seek", point, reason: "initial" };
  if (!isContinuous(input.previous, point)) return { kind: "seek", point, reason: "source_discontinuity" };

  if (input.observedSourceUs !== undefined && input.observedSourceUs !== null) {
    const tolerance = input.seekToleranceUs ?? HVE_SEQUENCE_DEFAULT_SEEK_TOLERANCE_US;
    if (!Number.isFinite(input.observedSourceUs) || tolerance < 0) throw new Error("HVE_SEQUENCE_SEEK_INPUT_INVALID");
    if (Math.abs(point.sourceUs - input.observedSourceUs) > tolerance) {
      return { kind: "seek", point, reason: "clock_drift" };
    }
  }
  return { kind: "continue", point };
}
