import { and, eq, lt, gt } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { transcriptSegments, transcripts } from "../../../../db/schema.js";

export interface SubtitleCue {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Builds the subtitle cues a clip render actually burns in. Previously every
 * render job hardcoded `subtitleCues: []`, so the worker's ASS pass was
 * always skipped (see stages.py) and no clip ever had subtitles regardless
 * of what the style configured — this is the fix.
 *
 * Segment-level only: `transcript_segments.words` is jsonb but nothing in
 * this codebase writes word-level timing yet (confirmed — no STT stage
 * populates it), so per-word cues/highlighting aren't derivable server-side.
 * A cue here is one transcript segment (a sentence/speaker turn), clipped to
 * the render range and re-timed to start at 0 for the clip's own timeline.
 *
 * Also does not yet apply saved transcript-revision edits (hide_word/
 * cut_word/replace_text) — those operations are persisted in
 * `transcript_revisions.operations` but nothing replays them into a final
 * text anywhere in the backend. That is a separate, larger gap; see
 * backend-capability-map.
 */
export async function buildSubtitleCues(
  db: Database,
  sourceId: string,
  rangeStartMs: number,
  rangeEndMs: number,
): Promise<SubtitleCue[]> {
  const [transcript] = await db
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.sourceId, sourceId))
    .limit(1);
  if (!transcript) return [];

  const segments = await db
    .select({
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      originalText: transcriptSegments.originalText,
    })
    .from(transcriptSegments)
    .where(and(
      eq(transcriptSegments.transcriptId, transcript.id),
      lt(transcriptSegments.startMs, rangeEndMs),
      gt(transcriptSegments.endMs, rangeStartMs),
    ))
    .orderBy(transcriptSegments.ordinal);

  const duration = rangeEndMs - rangeStartMs;
  return segments
    .map((segment) => ({
      text: segment.originalText,
      startMs: Math.max(0, Number(segment.startMs) - rangeStartMs),
      endMs: Math.min(duration, Number(segment.endMs) - rangeStartMs),
    }))
    .filter((cue) => cue.text.trim().length > 0 && cue.endMs > cue.startMs);
}
