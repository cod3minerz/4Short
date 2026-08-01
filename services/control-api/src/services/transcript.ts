import { eq } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { transcriptSegments } from "../../../../db/schema.js";

type ParsedSegment = {
  ordinal: number;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  originalText: string;
  words: Array<Record<string, unknown>>;
};

/**
 * The STT response is stored verbatim on `transcripts.originalPayload`
 * (opaque jsonb) and, until now, nothing ever decomposed it into
 * `transcript_segments` rows — meaning the transcript panel, word-level
 * editing and subtitle timing all silently had zero real data for every
 * connected project (see `backend-capability-map`). Only the OpenAI-Whisper
 * `verbose_json` shape (used by `OpenAICompatibleStt` in the worker) is
 * parsed here — that shape is stable and well-documented. Yandex
 * SpeechKit v3's async-recognition response (`YandexSpeechKit`) has a
 * materially different, more deeply-nested shape (per-channel/per-chunk
 * alternatives) that would need verifying against a live response before
 * it's safe to parse; returns `null` rather than guess.
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
      const wordStart = typeof w.start === "number" ? w.start : null;
      return wordStart !== null && wordStart >= start && wordStart < end;
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
