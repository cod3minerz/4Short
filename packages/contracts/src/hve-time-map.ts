import { z } from "zod";
import {
  captionPlanSchema,
  captionTrackSchema,
  engineWarningSchema,
  narrativeSegmentSchema,
  timeMapSchema,
  timeRangeUsSchema,
  type CaptionPlan,
  type TimeMapEntry,
} from "./hve-v2.js";

/** A removal is always source-time based. It never refers to the mutable output timeline. */
export const timelineRemovalSchema = z.object({
  sourceId: z.string().uuid(),
  sourceRange: timeRangeUsSchema,
  reason: z.enum(["user", "pause", "filler"]),
}).strict();

export const timingTranscriptWordSchema = z.object({
  wordId: z.string().min(1).max(160),
  sourceId: z.string().uuid(),
  sourceRange: timeRangeUsSchema,
  text: z.string().trim().min(1).max(240),
  speakerId: z.string().max(120).optional(),
}).strict();

export const buildTimeMapInputSchema = z.object({
  narrative: z.array(narrativeSegmentSchema).min(1).max(200),
  removals: z.array(timelineRemovalSchema).max(10_000).default([]),
  /** Pause joins may overlap A/V on the shared output clock. */
  crossfadeUs: z.number().int().nonnegative().max(500_000).default(0),
}).strict();

export const buildCaptionPlanInputSchema = z.object({
  timeMap: timeMapSchema,
  transcriptWords: z.array(timingTranscriptWordSchema).max(40_000),
  track: captionTrackSchema,
  maxGapUs: z.number().int().min(0).max(10_000_000).default(900_000),
  maxCueDurationUs: z.number().int().positive().max(20_000_000).default(5_500_000),
}).strict();

export type TimelineRemoval = z.infer<typeof timelineRemovalSchema>;
export type TimingTranscriptWord = z.infer<typeof timingTranscriptWordSchema>;
export type BuildTimeMapInput = z.input<typeof buildTimeMapInputSchema>;
export type BuildCaptionPlanInput = z.input<typeof buildCaptionPlanInputSchema>;

type Range = { startUs: number; endUs: number };

function rangeDuration(range: Range): number {
  return range.endUs - range.startUs;
}

function intersect(left: Range, right: Range): Range | null {
  const startUs = Math.max(left.startUs, right.startUs);
  const endUs = Math.min(left.endUs, right.endUs);
  return endUs > startUs ? { startUs, endUs } : null;
}

function subtractRange(source: Range, removals: Range[]): Range[] {
  let cursor = source.startUs;
  const kept: Range[] = [];
  for (const removal of removals) {
    const overlap = intersect(source, removal);
    if (!overlap) continue;
    if (overlap.startUs > cursor) kept.push({ startUs: cursor, endUs: overlap.startUs });
    cursor = Math.max(cursor, overlap.endUs);
    if (cursor >= source.endUs) break;
  }
  if (cursor < source.endUs) kept.push({ startUs: cursor, endUs: source.endUs });
  return kept;
}

function normalizeRemovals(removals: TimelineRemoval[]): Map<string, Range[]> {
  const bySource = new Map<string, Range[]>();
  for (const removal of removals) {
    const rows = bySource.get(removal.sourceId) ?? [];
    rows.push(removal.sourceRange);
    bySource.set(removal.sourceId, rows);
  }
  for (const [sourceId, rows] of bySource) {
    const normalized: Range[] = [];
    for (const range of [...rows].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)) {
      const last = normalized.at(-1);
      if (last && range.startUs <= last.endUs) last.endUs = Math.max(last.endUs, range.endUs);
      else normalized.push({ ...range });
    }
    bySource.set(sourceId, normalized);
  }
  return bySource;
}

function hasPauseRemovalBetween(
  removals: TimelineRemoval[],
  sourceId: string,
  left: Range,
  right: Range,
) {
  return removals.some((removal) => (
    removal.reason === "pause"
    && removal.sourceId === sourceId
    && removal.sourceRange.startUs <= left.endUs
    && removal.sourceRange.endUs >= right.startUs
  ));
}

function appliedCrossfadeUs(requestedUs: number, previousDurationUs: number, nextDurationUs: number) {
  if (requestedUs <= 0) return 0;
  // A crossfade that consumes an entire retained fragment creates ambiguous
  // caption and editor semantics. Preserve enough independent material on
  // both sides even for a pathological short VAD split.
  return Math.min(requestedUs, Math.floor(previousDurationUs / 2), Math.floor(nextDurationUs / 2));
}

/**
 * Converts ordered source narrative into a contiguous output clock. The same
 * result drives audio, video, subtitles and editor playback; no downstream
 * stage may independently reinterpret pause/user cuts.
 */
export function buildTimeMap(input: BuildTimeMapInput): TimeMapEntry[] {
  const value = buildTimeMapInputSchema.parse(input);
  const removalsBySource = normalizeRemovals(value.removals);
  const narrative = value.narrative.filter((segment) => segment.enabled).sort((a, b) => a.order - b.order);
  if (!narrative.length) throw new Error("HVE_TIME_MAP_NO_ENABLED_NARRATIVE");
  const orders = new Set<number>();
  for (const segment of narrative) {
    if (orders.has(segment.order)) throw new Error("HVE_TIME_MAP_DUPLICATE_NARRATIVE_ORDER");
    orders.add(segment.order);
  }

  const map: TimeMapEntry[] = [];
  let outputCursorUs = 0;
  for (const segment of narrative) {
    const kept = subtractRange(segment.sourceRange, removalsBySource.get(segment.sourceId) ?? []);
    let previousKept: Range | undefined;
    for (const sourceRange of kept) {
      const durationUs = rangeDuration(sourceRange);
      const previousEntry = map.at(-1);
      const transitionInUs = previousKept && previousEntry && hasPauseRemovalBetween(
        value.removals,
        segment.sourceId,
        previousKept,
        sourceRange,
      )
        ? appliedCrossfadeUs(value.crossfadeUs, rangeDuration(previousKept), durationUs)
        : 0;
      const outputStartUs = outputCursorUs - transitionInUs;
      map.push({
        sourceId: segment.sourceId,
        sourceRange,
        outputRange: { startUs: outputStartUs, endUs: outputStartUs + durationUs },
        rate: { numerator: 1, denominator: 1 },
        ...(transitionInUs ? { transitionInUs } : {}),
      });
      outputCursorUs = outputStartUs + durationUs;
      previousKept = sourceRange;
    }
  }
  if (!map.length) throw new Error("HVE_TIME_MAP_ALL_NARRATIVE_REMOVED");
  return timeMapSchema.parse(map);
}

/**
 * Converts word-timing gaps to removable source intervals. This is a
 * conservative fallback until the VAD artifact is available: it never cuts
 * inside a known word, never removes a leading/trailing edge, and keeps the
 * configured padding around spoken words. A VAD-derived removal can be added
 * by the caller and wins naturally through the same normalized time map.
 */
export function derivePauseRemovals(
  transcriptWords: TimingTranscriptWord[],
  policy: { enabled: boolean; minimumUs: number; beforePaddingUs: number; afterPaddingUs: number },
): TimelineRemoval[] {
  if (!policy.enabled) return [];
  const bySource = new Map<string, TimingTranscriptWord[]>();
  for (const word of transcriptWords) {
    const words = bySource.get(word.sourceId) ?? [];
    words.push(word);
    bySource.set(word.sourceId, words);
  }
  const removals: TimelineRemoval[] = [];
  for (const [sourceId, words] of bySource) {
    const ordered = [...words].sort((left, right) => left.sourceRange.startUs - right.sourceRange.startUs || left.sourceRange.endUs - right.sourceRange.endUs);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].sourceRange;
      const current = ordered[index].sourceRange;
      const gapUs = current.startUs - previous.endUs;
      if (gapUs < policy.minimumUs) continue;
      const startUs = previous.endUs + policy.afterPaddingUs;
      const endUs = current.startUs - policy.beforePaddingUs;
      if (endUs > startUs) removals.push({ sourceId, sourceRange: { startUs, endUs }, reason: "pause" });
    }
  }
  return removals;
}

/** Converts explicit transcript "cut from media" edits into source-time cuts. */
export function deriveTextCutRemovals(
  transcriptWords: TimingTranscriptWord[],
  track: z.input<typeof captionTrackSchema>,
): TimelineRemoval[] {
  const parsedTrack = captionTrackSchema.parse(track);
  const wordsById = new Map(transcriptWords.map((word) => [word.wordId, word]));
  return parsedTrack.words.flatMap((override) => {
    if (!override.cutFromMedia) return [];
    const word = wordsById.get(override.wordId);
    return word ? [{ sourceId: word.sourceId, sourceRange: word.sourceRange, reason: "user" as const }] : [];
  });
}

function scaledFloor(value: number, entry: TimeMapEntry): number {
  return Math.floor((value * entry.rate.denominator) / entry.rate.numerator);
}

function scaledCeil(value: number, entry: TimeMapEntry): number {
  return Math.ceil((value * entry.rate.denominator) / entry.rate.numerator);
}

/** Maps a source interval to every retained output interval, preserving order. */
export function mapSourceRangeToOutput(timeMap: TimeMapEntry[], sourceId: string, sourceRange: Range) {
  return timeMapSchema.parse(timeMap).flatMap((entry) => {
    if (entry.sourceId !== sourceId) return [];
    const overlap = intersect(entry.sourceRange, sourceRange);
    if (!overlap) return [];
    const sourceOffsetStart = overlap.startUs - entry.sourceRange.startUs;
    const sourceOffsetEnd = overlap.endUs - entry.sourceRange.startUs;
    return [{
      sourceRange: overlap,
      outputRange: {
        startUs: entry.outputRange.startUs + scaledFloor(sourceOffsetStart, entry),
        endUs: entry.outputRange.startUs + scaledCeil(sourceOffsetEnd, entry),
      },
    }];
  }).filter((value) => value.outputRange.endUs > value.outputRange.startUs);
}

function formatCaptionTime(us: number, separator: "." | ","): string {
  const milliseconds = Math.max(0, Math.floor(us / 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const fraction = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(fraction).padStart(3, "0")}`;
}

type PlannedWord = { wordId: string; text: string; outputRange: Range; speakerId?: string };

function makeCue(words: PlannedWord[], maxWordsPerLine: number) {
  const lines: string[] = [];
  for (let index = 0; index < words.length; index += maxWordsPerLine) {
    lines.push(words.slice(index, index + maxWordsPerLine).map((word) => word.text).join(" "));
  }
  return {
    outputRange: { startUs: words[0].outputRange.startUs, endUs: words.at(-1)!.outputRange.endUs },
    lines,
    activeWordIds: words.map((word) => word.wordId),
    words: words.map((word) => ({
      wordId: word.wordId,
      text: word.text,
      outputRange: word.outputRange,
      ...(word.speakerId ? { speakerId: word.speakerId } : {}),
    })),
  };
}

/**
 * Resolves visible transcript words onto the output timeline. A word that is
 * split by a cut is deliberately suppressed with a warning: showing it as a
 * continuous active caption would be more misleading than omitting it.
 */
export function buildCaptionPlan(input: BuildCaptionPlanInput): CaptionPlan {
  const value = buildCaptionPlanInputSchema.parse(input);
  if (!value.track.enabled) return captionPlanSchema.parse({ cues: [], warnings: [] });
  const overrideByWord = new Map(value.track.words.map((word) => [word.wordId, word]));
  const warnings: z.infer<typeof engineWarningSchema>[] = [];
  const planned: PlannedWord[] = [];

  for (const word of value.transcriptWords) {
    const override = overrideByWord.get(word.wordId);
    if (override?.hidden || override?.cutFromMedia) continue;
    const mapped = mapSourceRangeToOutput(value.timeMap, word.sourceId, word.sourceRange);
    if (mapped.length !== 1 || mapped[0].sourceRange.startUs !== word.sourceRange.startUs || mapped[0].sourceRange.endUs !== word.sourceRange.endUs) {
      warnings.push({
        code: "HVE_CAPTION_WORD_CUT",
        range: word.sourceRange,
        requested: word.wordId,
        applied: "hidden",
        userMessage: "Одно слово пересекает вырезанный фрагмент и не показано в субтитрах.",
        severity: "warning",
      });
      continue;
    }
    const text = (override?.displayText ?? word.text).trim();
    if (!text) continue;
    planned.push({
      wordId: word.wordId,
      text: value.track.style.uppercase ? text.toUpperCase() : text,
      outputRange: mapped[0].outputRange,
      ...(word.speakerId ? { speakerId: word.speakerId } : {}),
    });
  }

  planned.sort((left, right) => left.outputRange.startUs - right.outputRange.startUs || left.outputRange.endUs - right.outputRange.endUs || left.wordId.localeCompare(right.wordId));
  const cues: ReturnType<typeof makeCue>[] = [];
  const maxCueWords = value.track.style.maxWordsPerLine * value.track.style.maxLines;
  let buffer: PlannedWord[] = [];
  for (const word of planned) {
    const previous = buffer.at(-1);
    const startsNewCue = previous !== undefined && (
      // During a crossfade source words may intentionally overlap on the
      // output clock. They must never be merged into one caption sentence.
      word.outputRange.startUs < previous.outputRange.endUs
      ||
      word.outputRange.startUs - previous.outputRange.endUs > value.maxGapUs
      || word.outputRange.endUs - buffer[0].outputRange.startUs > value.maxCueDurationUs
      || buffer.length >= maxCueWords
    );
    if (startsNewCue) {
      cues.push(makeCue(buffer, value.track.style.maxWordsPerLine));
      buffer = [];
    }
    buffer.push(word);
  }
  if (buffer.length) cues.push(makeCue(buffer, value.track.style.maxWordsPerLine));
  return captionPlanSchema.parse({ cues, warnings });
}

export function captionPlanToSrt(plan: CaptionPlan): string {
  return plan.cues.map((cue, index) => `${index + 1}\n${formatCaptionTime(cue.outputRange.startUs, ",")} --> ${formatCaptionTime(cue.outputRange.endUs, ",")}\n${cue.lines.join("\n")}\n`).join("\n");
}

export function captionPlanToVtt(plan: CaptionPlan): string {
  return `WEBVTT\n\n${plan.cues.map((cue) => `${formatCaptionTime(cue.outputRange.startUs, ".")} --> ${formatCaptionTime(cue.outputRange.endUs, ".")}\n${cue.lines.join("\n")}`).join("\n\n")}\n`;
}

/**
 * Adapts the canonical v2 caption plan to the ASS renderer input without
 * reconstructing timing from transcript text. Start times floor and end times
 * ceil to milliseconds, preserving each rendered word rather than shortening
 * it during the legacy renderer boundary.
 */
export function captionPlanToAssCues(plan: CaptionPlan) {
  return plan.cues.map((cue, index) => ({
    id: `hve2-cue-${index + 1}`,
    text: cue.lines.join("\n"),
    startMs: Math.floor(cue.outputRange.startUs / 1_000),
    endMs: Math.ceil(cue.outputRange.endUs / 1_000),
    speakerId: cue.words[0]?.speakerId,
    words: cue.words.map((word) => ({
      id: word.wordId,
      text: word.text,
      startMs: Math.floor(word.outputRange.startUs / 1_000),
      endMs: Math.ceil(word.outputRange.endUs / 1_000),
      speakerId: word.speakerId,
    })),
  }));
}
