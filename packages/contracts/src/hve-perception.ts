import { z } from "zod";
import { engineWarningSchema, normalizedRectSchema, timeRangeUsSchema, timeUsSchema } from "./hve-v2.js";

/**
 * HVE-5 perception artifacts are immutable, sparse and source-scoped. They
 * intentionally contain coordinates/features only — never raw video frames.
 */
export const hveContentTypeSchema = z.enum([
  "solo",
  "conversation",
  "panel",
  "remote_grid",
  "screen_speaker",
  "screen_only",
  "gameplay_facecam",
  "gameplay_only",
  "vertical_source",
  "slides",
  "mixed",
  "unknown",
]);

export const hveContentProbabilitiesSchema = z.object({
  solo: z.number().min(0).max(1).optional(),
  conversation: z.number().min(0).max(1).optional(),
  panel: z.number().min(0).max(1).optional(),
  remote_grid: z.number().min(0).max(1).optional(),
  screen_speaker: z.number().min(0).max(1).optional(),
  screen_only: z.number().min(0).max(1).optional(),
  gameplay_facecam: z.number().min(0).max(1).optional(),
  gameplay_only: z.number().min(0).max(1).optional(),
  vertical_source: z.number().min(0).max(1).optional(),
  slides: z.number().min(0).max(1).optional(),
  mixed: z.number().min(0).max(1).optional(),
  unknown: z.number().min(0).max(1).optional(),
}).strict();

export const hveShotSchema = z.object({
  id: z.string().min(1).max(160),
  range: timeRangeUsSchema,
  confidence: z.number().min(0).max(1),
  reason: z.enum(["histogram_cut", "fade", "manual", "unknown"]),
}).strict();

export const hveTrackKeyframeSchema = z.object({
  atUs: timeUsSchema,
  box: normalizedRectSchema,
  confidence: z.number().min(0).max(1),
}).strict();

export const hveRegionTrackSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(["face", "screen", "gameplay", "facecam", "slide", "other"]),
  range: timeRangeUsSchema,
  keyframes: z.array(hveTrackKeyframeSchema).min(1).max(20_000),
  confidence: z.number().min(0).max(1),
  provenance: z.object({
    detector: z.string().min(1).max(160),
    modelVersion: z.string().min(1).max(160),
  }).strict(),
}).strict();

export const hveSpeakerTurnSchema = z.object({
  speakerId: z.string().min(1).max(160),
  range: timeRangeUsSchema,
  confidence: z.number().min(0).max(1),
}).strict();

/**
 * A compact, time-bounded mouth-motion summary for one already stable face
 * track.  This is evidence for the association stage, not a facial embedding,
 * landmark set, decoded frame or identity record.  The dense source artifact
 * lives in private object storage; PostgreSQL only ever stores its manifest.
 */
export const hveMouthActivityWindowSchema = z.object({
  faceTrackId: z.string().min(1).max(160),
  range: timeRangeUsSchema,
  activity: z.number().min(0).max(1),
  faceConfidence: z.number().min(0).max(1),
}).strict();

export const hveActiveSpeakerLinkSchema = z.object({
  range: timeRangeUsSchema,
  speakerId: z.string().min(1).max(160),
  faceTrackId: z.string().min(1).max(160).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.enum(["audio_video_association", "offscreen", "insufficient_evidence"]),
}).strict();

/**
 * Immutable HVE-5 hand-off between diarization, dense landmarks and the pure
 * association scorer.  It intentionally has no raw audio, frame, landmark or
 * embedding field.  Until an evaluated worker can create this artifact, the
 * public product must keep active-speaker controls locked.
 */
export const hveActiveSpeakerArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  analysisId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  engineVersion: z.string().min(1).max(160),
  generatedAt: z.string().datetime(),
  durationUs: z.number().int().positive(),
  faceAnalysisComplete: z.boolean(),
  speakerTurns: z.array(hveSpeakerTurnSchema).max(100_000),
  mouthActivity: z.array(hveMouthActivityWindowSchema).max(500_000),
  activeSpeakerLinks: z.array(hveActiveSpeakerLinkSchema).max(100_000),
  provenance: z.object({
    diarization: z.object({
      engine: z.string().min(1).max(160),
      modelVersion: z.string().min(1).max(160),
      artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    }).strict(),
    mouthActivity: z.object({
      engine: z.string().min(1).max(160),
      modelVersion: z.string().min(1).max(160),
      artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    }).strict(),
  }).strict(),
  warnings: z.array(engineWarningSchema).max(2_000),
  /** Canonical SHA-256 of this artifact before this self-reference is added. */
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().superRefine((value, context) => {
  const insideDuration = (range: { startUs: number; endUs: number }) => (
    range.startUs >= 0 && range.endUs <= value.durationUs
  );
  for (const [index, turn] of value.speakerTurns.entries()) {
    if (!insideDuration(turn.range)) {
      context.addIssue({ code: "custom", path: ["speakerTurns", index, "range"], message: "Speaker turn must stay inside the source duration." });
    }
  }
  for (const [index, window] of value.mouthActivity.entries()) {
    if (!insideDuration(window.range)) {
      context.addIssue({ code: "custom", path: ["mouthActivity", index, "range"], message: "Mouth-activity window must stay inside the source duration." });
    }
  }
  for (const [index, link] of value.activeSpeakerLinks.entries()) {
    if (!insideDuration(link.range)) {
      context.addIssue({ code: "custom", path: ["activeSpeakerLinks", index, "range"], message: "Active-speaker link must stay inside the source duration." });
    }
    const matchingTurn = value.speakerTurns.some((turn) => (
      turn.speakerId === link.speakerId
      && turn.range.startUs <= link.range.startUs
      && turn.range.endUs >= link.range.endUs
    ));
    if (!matchingTurn) {
      context.addIssue({ code: "custom", path: ["activeSpeakerLinks", index], message: "Active-speaker link must be contained by a matching diarized speaker turn." });
    }
    if (link.reason === "audio_video_association" && !link.faceTrackId) {
      context.addIssue({ code: "custom", path: ["activeSpeakerLinks", index, "faceTrackId"], message: "An audio-video association requires a face track." });
    }
    if (link.reason !== "audio_video_association" && link.faceTrackId) {
      context.addIssue({ code: "custom", path: ["activeSpeakerLinks", index, "faceTrackId"], message: "Fallback links must not claim a face track." });
    }
  }
});

export const hveSceneClassificationSchema = z.object({
  range: timeRangeUsSchema,
  probabilities: hveContentProbabilitiesSchema,
  evidence: z.array(z.string().min(1).max(160)).max(80),
}).strict();

export const hveSceneGraphSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  engineVersion: z.string().min(1).max(160),
  generatedAt: z.string().datetime(),
  durationUs: z.number().int().positive(),
  shots: z.array(hveShotSchema).max(20_000),
  regions: z.array(hveRegionTrackSchema).max(10_000),
  speakerTurns: z.array(hveSpeakerTurnSchema).max(100_000),
  activeSpeakerLinks: z.array(hveActiveSpeakerLinkSchema).max(100_000),
  classifications: z.array(hveSceneClassificationSchema).max(20_000),
  warnings: z.array(engineWarningSchema).max(2_000),
}).strict().superRefine((value, context) => {
  for (const [index, track] of value.regions.entries()) {
    let previousAt = -1;
    for (const keyframe of track.keyframes) {
      if (keyframe.atUs < track.range.startUs || keyframe.atUs >= track.range.endUs) {
        context.addIssue({ code: "custom", path: ["regions", index, "keyframes"], message: "Track keyframes must stay inside the track range." });
      }
      if (keyframe.atUs <= previousAt) {
        context.addIssue({ code: "custom", path: ["regions", index, "keyframes"], message: "Track keyframes must be strictly monotonic." });
      }
      previousAt = keyframe.atUs;
    }
  }
});

export type HveContentType = z.infer<typeof hveContentTypeSchema>;
export type HveSceneGraph = z.infer<typeof hveSceneGraphSchema>;
export type HveActiveSpeakerArtifact = z.infer<typeof hveActiveSpeakerArtifactSchema>;

/**
 * Bounded editor-facing view of a face track. It intentionally contains no
 * decoded frame, embedding or raw detector output: the editor needs only a
 * verified identity and whether that identity is usable over its exact clip
 * source range.
 */
export type HveFaceTrackForRange = {
  trackId: string;
  confidence: number;
  sourceRange: { startUs: number; endUs: number };
  keyframeCount: number;
};

/**
 * Returns only face tracks whose region and keyframes cover the entire
 * requested source interval. This mirrors HVE-6's commit preflight so a UI
 * does not offer a participant that would later degrade into a static crop.
 */
export function faceTracksCoveringSourceRange(
  graphInput: HveSceneGraph,
  sourceRangeInput: { startUs: number; endUs: number },
): HveFaceTrackForRange[] {
  const graph = hveSceneGraphSchema.parse(graphInput);
  const sourceRange = timeRangeUsSchema.parse(sourceRangeInput);
  return graph.regions
    .filter((track) => {
      if (track.kind !== "face") return false;
      const first = track.keyframes[0];
      const last = track.keyframes.at(-1);
      return Boolean(
        first && last
        && track.range.startUs <= sourceRange.startUs
        && track.range.endUs >= sourceRange.endUs
        && first.atUs <= sourceRange.startUs
        && last.atUs >= sourceRange.endUs - 1,
      );
    })
    .map((track) => ({
      trackId: track.id,
      confidence: track.confidence,
      sourceRange: { startUs: track.range.startUs, endUs: track.range.endUs },
      keyframeCount: track.keyframes.length,
    }))
    .sort((left, right) => right.confidence - left.confidence || left.trackId.localeCompare(right.trackId));
}
