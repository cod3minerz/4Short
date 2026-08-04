import { and, asc, eq, lte } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { transcriptRevisions, transcriptSegments, transcripts } from "../../../../db/schema.js";
import type { TimingTranscriptWord } from "../../../../packages/contracts/src/index.js";

type ParsedSegment = {
  ordinal: number;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  originalText: string;
  words: Array<Record<string, unknown>>;
};

type StoredRevisionOperation =
  | { type: "replace_text"; segmentId: string; text: string }
  | { type: "hide_word"; segmentId: string; wordIndex: number }
  | { type: "cut_word"; segmentId: string; wordIndex: number };

export type HveCaptionOverride = {
  wordId: string;
  displayText?: string;
  hidden: boolean;
  cutFromMedia: boolean;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStoredRevisionOperation(value: unknown): value is StoredRevisionOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Record<string, unknown>;
  if (operation.type === "replace_text") {
    return typeof operation.segmentId === "string" && typeof operation.text === "string";
  }
  return (operation.type === "hide_word" || operation.type === "cut_word")
    && typeof operation.segmentId === "string"
    && Number.isInteger(operation.wordIndex)
    && Number(operation.wordIndex) >= 0;
}

/**
 * Deterministically distributes a segment-level replacement over the stable
 * word IDs already timed by STT. The replacement changes display text only;
 * it never claims the audio itself has been synthesized or retimed. When the
 * replacement has fewer words, the remaining old tokens are hidden. When it
 * has more words, the last available timed word owns the tail of the display
 * string. This preserves every typed character without inventing timestamps.
 */
function distributeReplacement(wordIds: string[], replacement: string): Array<{ wordId: string; displayText?: string; hidden: boolean }> {
  const normalized = replacement.trim().replace(/\s+/g, " ");
  const tokens = normalized ? normalized.split(" ") : [];
  if (!wordIds.length || !tokens.length) {
    return wordIds.map((wordId) => ({ wordId, hidden: true }));
  }
  return wordIds.map((wordId, index) => {
    if (index >= tokens.length) return { wordId, hidden: true };
    const isLastAvailableWord = index === wordIds.length - 1;
    return {
      wordId,
      displayText: isLastAvailableWord ? tokens.slice(index).join(" ") : tokens[index],
      hidden: false,
    };
  });
}

/**
 * Projects append transcript revisions, while an HVE document must be
 * immutable. This pure reducer turns the selected revision history into the
 * exact per-word overrides captured in that document. It intentionally has no
 * database/media dependency so operation ordering can be unit-tested.
 */
export function reduceTranscriptRevisionsToCaptionOverrides(
  wordIdsBySegment: Map<string, string[]>,
  revisionOperations: ReadonlyArray<ReadonlyArray<unknown>>,
): HveCaptionOverride[] {
  const byWord = new Map<string, HveCaptionOverride>();
  for (const operations of revisionOperations) {
    for (const rawOperation of operations) {
      if (!isStoredRevisionOperation(rawOperation)) continue;
      const wordIds = wordIdsBySegment.get(rawOperation.segmentId) ?? [];
      if (rawOperation.type === "replace_text") {
        for (const next of distributeReplacement(wordIds, rawOperation.text)) {
          const previous = byWord.get(next.wordId);
          // A replacement intentionally refreshes visible display text, but a
          // prior audio cut can never be resurrected by a caption edit.
          const cutFromMedia = previous?.cutFromMedia ?? false;
          byWord.set(next.wordId, {
            ...next,
            hidden: cutFromMedia || next.hidden,
            cutFromMedia,
          });
        }
        continue;
      }
      const wordId = wordIds[rawOperation.wordIndex];
      if (!wordId) continue;
      const previous = byWord.get(wordId) ?? { wordId, hidden: false, cutFromMedia: false };
      byWord.set(wordId, {
        ...previous,
        hidden: true,
        cutFromMedia: rawOperation.type === "cut_word" || previous.cutFromMedia,
      });
    }
  }
  return [...byWord.values()]
    .sort((left, right) => left.wordId.localeCompare(right.wordId));
}

/**
 * The STT response is stored verbatim on `transcripts.originalPayload`
 * (opaque jsonb) and, until now, nothing ever decomposed it into
 * `transcript_segments` rows — meaning the transcript panel, word-level
 * editing and subtitle timing had no real data. The worker now has one
 * canonical Faster-Whisper response shape, stored verbatim and decomposed
 * here into deterministic segment rows.
 */
export function parseSttResponse(response: unknown): ParsedSegment[] | null {
  if (!response || typeof response !== "object") return null;
  const payload = response as Record<string, unknown>;
  const rawSegments = payload.segments;
  if (!Array.isArray(rawSegments) || !rawSegments.length) return null;

  const rawWords = Array.isArray(payload.words) ? payload.words : [];

  return rawSegments.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const segment = entry as Record<string, unknown>;
    const start = typeof segment.start === "number" ? segment.start : null;
    const end = typeof segment.end === "number" ? segment.end : null;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (start === null || end === null || end <= start || !text) return [];

    const startMs = Math.round(start * 1000);
    const endMs = Math.round(end * 1000);
    const words = rawWords.filter((word) => {
      if (!word || typeof word !== "object") return false;
      const w = word as Record<string, unknown>;
      if (typeof w.segmentIndex === "number") return w.segmentIndex === index;
      const wordStart = typeof w.start === "number" ? w.start : null;
      const wordStartMs = typeof w.startMs === "number" ? w.startMs : null;
      return (wordStart !== null && wordStart >= start && wordStart < end)
        || (wordStartMs !== null && wordStartMs >= startMs && wordStartMs < endMs);
    }) as Array<Record<string, unknown>>;

    return [{
      ordinal: index,
      speakerId: null,
      startMs,
      endMs,
      originalText: text,
      words,
    }];
  });
}

export async function writeTranscriptSegments(db: Database, transcriptId: string, segments: ParsedSegment[]) {
  await db.delete(transcriptSegments).where(eq(transcriptSegments.transcriptId, transcriptId));
  if (!segments.length) return;
  await db.insert(transcriptSegments).values(segments.map((segment) => ({
    transcriptId,
    ordinal: segment.ordinal,
    speakerId: segment.speakerId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    originalText: segment.originalText,
    words: segment.words,
  })));
}

/**
 * HVE v2 receives absolute source-time words. Transcript revisions are
 * represented by the immutable ClipDocumentV2 caption overrides, so this
 * function intentionally returns the canonical STT timing rather than
 * re-applying mutable UI text in a second place.
 */
export async function readTimingTranscriptWords(
  db: Database,
  sourceId: string,
): Promise<TimingTranscriptWord[]> {
  const [transcript] = await db
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.sourceId, sourceId))
    .limit(1);
  if (!transcript) return [];

  const segments = await db
    .select({
      id: transcriptSegments.id,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      originalText: transcriptSegments.originalText,
      speakerId: transcriptSegments.speakerId,
      words: transcriptSegments.words,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.transcriptId, transcript.id));

  return segments.flatMap((segment) => {
    const words = Array.isArray(segment.words) ? segment.words : [];
    const parsed = words.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const word = raw as Record<string, unknown>;
      const rawStart = finiteNumber(word.startMs) ?? (finiteNumber(word.start) === null ? null : Math.round(finiteNumber(word.start)! * 1_000));
      const rawEnd = finiteNumber(word.endMs) ?? (finiteNumber(word.end) === null ? null : Math.round(finiteNumber(word.end)! * 1_000));
      const text = String(word.word ?? word.text ?? "").trim();
      if (rawStart === null || rawEnd === null || rawEnd <= rawStart || !text) return [];
      return [{
        wordId: `${segment.id}:${index}`,
        sourceId,
        sourceRange: { startUs: rawStart * 1_000, endUs: rawEnd * 1_000 },
        text,
        ...(segment.speakerId ? { speakerId: segment.speakerId } : {}),
      } satisfies TimingTranscriptWord];
    });
    // Some STT providers do not provide word-level timestamps. HVE-2 must not
    // invent karaoke timings for them; one segment is an honest line-level
    // fallback and remains editable later.
    if (parsed.length) return parsed;
    const text = segment.originalText.trim();
    if (!text || Number(segment.endMs) <= Number(segment.startMs)) return [];
    return [{
      wordId: `${segment.id}:segment`,
      sourceId,
      sourceRange: { startUs: Number(segment.startMs) * 1_000, endUs: Number(segment.endMs) * 1_000 },
      text,
      ...(segment.speakerId ? { speakerId: segment.speakerId } : {}),
    } satisfies TimingTranscriptWord];
  }).sort((left, right) => left.sourceRange.startUs - right.sourceRange.startUs || left.sourceRange.endUs - right.sourceRange.endUs || left.wordId.localeCompare(right.wordId));
}

/**
 * Snapshot the canonical STT words and the selected append-only transcript
 * revision together. Callers use this only while creating a new immutable HVE
 * document; after that, its caption overrides are the source of truth for the
 * version and future transcript edits cannot mutate an already queued render.
 */
export async function readHveTranscriptSnapshot(
  db: Database,
  sourceId: string,
  requestedRevision?: number,
): Promise<{ revision: number; words: TimingTranscriptWord[]; captionOverrides: HveCaptionOverride[] }> {
  const [transcript] = await db
    .select({ id: transcripts.id, currentRevision: transcripts.currentRevision })
    .from(transcripts)
    .where(eq(transcripts.sourceId, sourceId))
    .limit(1);
  if (!transcript) return { revision: 0, words: [], captionOverrides: [] };

  const revision = Math.min(Math.max(0, requestedRevision ?? transcript.currentRevision), transcript.currentRevision);
  const [words, revisionRows] = await Promise.all([
    readTimingTranscriptWords(db, sourceId),
    revision > 0
      ? db.select({ operations: transcriptRevisions.operations })
        .from(transcriptRevisions)
        .where(and(
          eq(transcriptRevisions.transcriptId, transcript.id),
          lte(transcriptRevisions.revision, revision),
        ))
        .orderBy(asc(transcriptRevisions.revision))
      : Promise.resolve([]),
  ]);
  const wordIdsBySegment = new Map<string, string[]>();
  for (const word of words) {
    const separator = word.wordId.lastIndexOf(":");
    if (separator < 1) continue;
    const segmentId = word.wordId.slice(0, separator);
    const current = wordIdsBySegment.get(segmentId) ?? [];
    current.push(word.wordId);
    wordIdsBySegment.set(segmentId, current);
  }
  return {
    revision,
    words,
    captionOverrides: reduceTranscriptRevisionsToCaptionOverrides(
      wordIdsBySegment,
      revisionRows.map((row) => row.operations),
    ),
  };
}
