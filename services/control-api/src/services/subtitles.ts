import { and, asc, eq, gt, lt, lte } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { transcriptRevisions, transcriptSegments, transcripts } from "../../../../db/schema.js";

export interface SubtitleWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  probability?: number;
  speakerId?: string | null;
}

export interface SubtitleCue {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string | null;
  words: SubtitleWord[];
}

type RevisionOperation =
  | { type: "replace_text"; segmentId: string; text: string }
  | { type: "hide_word"; segmentId: string; wordIndex: number }
  | { type: "cut_word"; segmentId: string; wordIndex: number };

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseWord(
  value: Record<string, unknown>,
  segmentId: string,
  wordIndex: number,
  rangeStartMs: number,
  rangeEndMs: number,
  speakerId: string | null,
): SubtitleWord | null {
  const startSeconds = finiteNumber(value.start);
  const endSeconds = finiteNumber(value.end);
  const startMilliseconds = finiteNumber(value.startMs);
  const endMilliseconds = finiteNumber(value.endMs);
  const absoluteStartMs = startMilliseconds ?? (startSeconds === null ? null : Math.round(startSeconds * 1000));
  const absoluteEndMs = endMilliseconds ?? (endSeconds === null ? null : Math.round(endSeconds * 1000));
  const text = String(value.word ?? value.text ?? "").trim();
  if (absoluteStartMs === null || absoluteEndMs === null || absoluteEndMs <= absoluteStartMs || !text) return null;
  if (absoluteStartMs >= rangeEndMs || absoluteEndMs <= rangeStartMs) return null;
  const probability = finiteNumber(value.probability);
  return {
    id: `${segmentId}:${wordIndex}`,
    text,
    startMs: Math.max(0, absoluteStartMs - rangeStartMs),
    endMs: Math.min(rangeEndMs - rangeStartMs, absoluteEndMs - rangeStartMs),
    ...(probability === null ? {} : { probability }),
    speakerId,
  };
}

function isRevisionOperation(value: unknown): value is RevisionOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Record<string, unknown>;
  if (operation.type === "replace_text") {
    return typeof operation.segmentId === "string" && typeof operation.text === "string";
  }
  if (operation.type === "hide_word" || operation.type === "cut_word") {
    return typeof operation.segmentId === "string" && Number.isInteger(operation.wordIndex);
  }
  return false;
}

/**
 * Creates render-ready, clip-relative subtitle cues. Words keep the precise
 * Faster-Whisper timings so ASS can render active-word/karaoke modes without
 * running STT again. Saved transcript revisions are replayed deterministically.
 */
export async function buildSubtitleCues(
  db: Database,
  sourceId: string,
  rangeStartMs: number,
  rangeEndMs: number,
  requestedRevision?: number,
): Promise<SubtitleCue[]> {
  const [transcript] = await db
    .select({ id: transcripts.id, currentRevision: transcripts.currentRevision })
    .from(transcripts)
    .where(eq(transcripts.sourceId, sourceId))
    .limit(1);
  if (!transcript || rangeEndMs <= rangeStartMs) return [];

  const revision = Math.min(requestedRevision ?? transcript.currentRevision, transcript.currentRevision);
  const [segments, revisionRows] = await Promise.all([
    db
      .select({
        id: transcriptSegments.id,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        originalText: transcriptSegments.originalText,
        speakerId: transcriptSegments.speakerId,
        words: transcriptSegments.words,
      })
      .from(transcriptSegments)
      .where(and(
        eq(transcriptSegments.transcriptId, transcript.id),
        lt(transcriptSegments.startMs, rangeEndMs),
        gt(transcriptSegments.endMs, rangeStartMs),
      ))
      .orderBy(asc(transcriptSegments.ordinal)),
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

  const replacementBySegment = new Map<string, string>();
  const hiddenWords = new Set<string>();
  for (const row of revisionRows) {
    for (const rawOperation of row.operations) {
      if (!isRevisionOperation(rawOperation)) continue;
      if (rawOperation.type === "replace_text") {
        replacementBySegment.set(rawOperation.segmentId, rawOperation.text.trim());
      } else {
        hiddenWords.add(`${rawOperation.segmentId}:${rawOperation.wordIndex}`);
      }
    }
  }

  const duration = rangeEndMs - rangeStartMs;
  return segments.flatMap((segment) => {
    const replacement = replacementBySegment.get(segment.id);
    const parsedWords = (Array.isArray(segment.words) ? segment.words : [])
      .flatMap((word, index) => {
        if (!word || typeof word !== "object" || hiddenWords.has(`${segment.id}:${index}`)) return [];
        const parsed = parseWord(
          word as Record<string, unknown>,
          segment.id,
          index,
          rangeStartMs,
          rangeEndMs,
          segment.speakerId,
        );
        return parsed ? [parsed] : [];
      });
    const text = replacement ?? parsedWords.map((word) => word.text).join(" ") ?? segment.originalText;
    const fallbackText = text.trim() || segment.originalText.trim();
    if (!fallbackText) return [];

    // A free-form segment replacement no longer has a trustworthy one-to-one
    // mapping to the original words. Keep its segment timing and let line mode
    // render it as one cue instead of highlighting the wrong word.
    const words = replacement === undefined ? parsedWords : [];
    const startMs = words.length
      ? words[0].startMs
      : Math.max(0, Number(segment.startMs) - rangeStartMs);
    const endMs = words.length
      ? words[words.length - 1].endMs
      : Math.min(duration, Number(segment.endMs) - rangeStartMs);
    if (endMs <= startMs) return [];
    return [{
      id: segment.id,
      text: fallbackText,
      startMs,
      endMs,
      speakerId: segment.speakerId,
      words,
    }];
  });
}
