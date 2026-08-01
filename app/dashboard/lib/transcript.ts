import type { getTranscript } from "./control-api";

type ApiSegment = Awaited<ReturnType<typeof getTranscript>>["segments"][number];

export type EditorWord = {
  /** Stable identity: transcript revisions address words as (segmentId, wordIndex). */
  id: string;
  segmentId: string;
  wordIndex: number;
  word: string;
  speaker: string;
  /** Playback position in seconds. */
  seconds: number;
  endSeconds: number;
  /** Clock label for the start of the speaker turn this word belongs to. */
  time: string;
};

function clock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * The `words` column is untyped jsonb (`Array<Record<string, unknown>>`) and
 * nothing in this repo writes it yet, so we cannot rely on a field name. Read
 * the first key that looks right and fall back to splitting `originalText`.
 */
function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function toEditorWords(segments: ApiSegment[]): EditorWord[] {
  return segments.flatMap((segment) => {
    const startSeconds = segment.startMs / 1000;
    const endSeconds = segment.endMs / 1000;
    const speaker = segment.speakerId ?? "Спикер";
    const turnLabel = clock(startSeconds);

    const raw = Array.isArray(segment.words) ? segment.words : [];
    const texts = raw.length
      ? raw.map((entry, index) => pickString(entry, ["text", "word", "value", "token"]) ?? `#${index + 1}`)
      : segment.originalText.split(/\s+/).filter(Boolean);

    const span = Math.max(endSeconds - startSeconds, 0);
    return texts.map((word, index) => {
      const entry = raw[index];
      const ms = entry ? pickNumber(entry, ["startMs", "start_ms", "beginMs"]) : null;
      const sec = entry ? pickNumber(entry, ["start", "startSeconds", "from"]) : null;
      // No per-word timing available: spread evenly across the segment so the
      // playhead still lands inside the right sentence.
      const fallback = startSeconds + (texts.length > 1 ? (span * index) / texts.length : 0);
      const wordStart = ms !== null ? ms / 1000 : sec !== null ? sec : fallback;
      const nextFallback = startSeconds + (texts.length > 1 ? (span * (index + 1)) / texts.length : span);

      return {
        id: `${segment.id}:${index}`,
        segmentId: segment.id,
        wordIndex: index,
        word,
        speaker,
        seconds: wordStart,
        endSeconds: Math.max(wordStart, nextFallback),
        time: turnLabel,
      };
    });
  });
}
