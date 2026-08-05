import { z } from "zod";
import { clipEdlSchema, type ClipEDL } from "./media.js";
import { hveFontPlanSchema } from "./hve-fonts.js";

/** HVE persists all media timing in integer microseconds and uses [start, end). */
export const HVE_TICKS_PER_SECOND = 1_000_000 as const;

export const timeUsSchema = z.number().int().nonnegative();
export const timeRangeUsSchema = z.object({
  startUs: timeUsSchema,
  endUs: z.number().int().positive(),
}).strict().refine((value) => value.endUs > value.startUs, {
  message: "endUs must be greater than startUs",
});

export const rationalSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
}).strict();

export const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().refine((value) => value.x + value.width <= 1 && value.y + value.height <= 1, {
  message: "normalized rect must fit inside the source frame",
});

export const rectPxSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const artifactRefSchema = z.object({
  artifactId: z.string().uuid(),
  kind: z.string().min(1).max(80),
  schemaVersion: z.number().int().positive(),
  engineVersion: z.string().min(1).max(120),
  modelVersion: z.string().min(1).max(120).optional(),
  objectKey: z.string().min(1).max(1_024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  byteSize: z.number().int().nonnegative(),
}).strict();

export const artifactSliceRefSchema = z.object({
  artifact: artifactRefSchema,
  coverage: z.array(timeRangeUsSchema).min(1).max(2_000),
  density: z.enum(["sparse", "dense"]),
  supersedes: z.array(z.string().uuid()).max(100).optional(),
}).strict();

export const mediaFactsSchema = z.object({
  durationUs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: rationalSchema,
  rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  hasAudio: z.boolean(),
  audioSampleRate: z.number().int().positive().optional(),
}).strict();

export const engineWarningSchema = z.object({
  code: z.string().min(1).max(80),
  range: timeRangeUsSchema.optional(),
  requested: z.string().max(240).optional(),
  applied: z.string().max(240).optional(),
  userMessage: z.string().min(1).max(500),
  severity: z.enum(["info", "warning", "error"]),
}).strict();

export const sourceAnalysisManifestSchema = z.object({
  schemaVersion: z.literal(1),
  analysisId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  media: mediaFactsSchema,
  artifacts: z.object({
    speech: artifactRefSchema.optional(),
    scenes: artifactRefSchema.optional(),
    regions: z.array(artifactSliceRefSchema).max(500).optional(),
    faces: z.array(artifactSliceRefSchema).max(500).optional(),
    speakers: z.array(artifactSliceRefSchema).max(500).optional(),
    associations: z.array(artifactSliceRefSchema).max(500).optional(),
    classification: z.array(artifactSliceRefSchema).max(500).optional(),
    thumbnails: artifactRefSchema.optional(),
    waveform: artifactRefSchema.optional(),
  }).strict(),
  warnings: z.array(engineWarningSchema).max(1_000),
  completedAt: z.string().datetime(),
}).strict();

export const sourceRefSchema = z.object({
  sourceId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  analysisId: z.string().uuid().optional(),
}).strict();

export const segmentAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("narrative_offset"), narrativeSegmentId: z.string().uuid(), offsetUs: z.number().int() }).strict(),
  z.object({ kind: z.literal("source_word"), wordId: z.string().min(1).max(160), edge: z.enum(["start", "end"]) }).strict(),
  z.object({ kind: z.literal("clip_start") }).strict(),
  z.object({ kind: z.literal("clip_end"), offsetUs: z.number().int().default(0) }).strict(),
]);

export const segmentAnchorRangeSchema = z.object({
  start: segmentAnchorSchema,
  end: segmentAnchorSchema,
}).strict();

export const decisionProvenanceSchema = z.object({
  origin: z.enum(["engine", "style", "project", "user"]),
  reasonCode: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1).optional(),
  alternatives: z.array(z.object({ template: z.string().min(1).max(80), score: z.number() }).strict()).max(12).optional(),
  engineVersion: z.string().min(1).max(120).optional(),
}).strict();

export const regionRefSchema = z.object({
  analysisId: z.string().uuid(),
  trackId: z.string().min(1).max(160),
  kind: z.enum(["source", "face", "screen", "gameplay", "image", "video", "synthetic"]),
}).strict();

export const cropTrackRefSchema = z.object({
  analysisId: z.string().uuid(),
  trackId: z.string().min(1).max(160),
}).strict();

export const slotAssignmentSchema = z.object({
  slotId: z.string().min(1).max(80),
  regionRef: regionRefSchema,
  fit: z.enum(["cover", "contain", "smart_cover"]),
  cropTrack: cropTrackRefSchema.optional(),
  manualCrop: normalizedRectSchema.optional(),
}).strict();

export const narrativeSegmentSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceRange: timeRangeUsSchema,
  enabled: z.boolean(),
  order: z.number().int().nonnegative(),
  transcriptWordIds: z.array(z.string().min(1).max(160)).max(20_000),
  transitionIn: z.enum(["cut", "crossfade"]).optional(),
  transitionOut: z.enum(["cut", "crossfade"]).optional(),
}).strict();

export const layoutSegmentSchema = z.object({
  id: z.string().uuid(),
  anchor: segmentAnchorRangeSchema,
  template: z.string().min(1).max(80),
  slots: z.array(slotAssignmentSchema).min(1).max(4),
  provenance: decisionProvenanceSchema,
  lockedByUser: z.boolean(),
}).strict();

const layerBaseSchema = z.object({
  id: z.string().uuid(),
  anchorRange: segmentAnchorRangeSchema,
  followPolicy: z.enum(["follow_narrative", "absolute_output", "clip_end", "source_word"]),
  zIndex: z.number().int().min(0).max(100),
  anchor: z.enum(["top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"]),
  box: normalizedRectSchema,
  opacity: z.number().min(0).max(1),
  collisionPolicy: z.enum(["move", "shrink", "warn", "allow"]),
});

export const productionLayerSchema = z.discriminatedUnion("type", [
  layerBaseSchema.extend({ type: z.literal("text"), text: z.string().min(1).max(500), styleRef: z.string().min(1).max(120) }).strict(),
  layerBaseSchema.extend({ type: z.literal("image"), assetId: z.string().uuid() }).strict(),
  layerBaseSchema.extend({ type: z.literal("video"), assetId: z.string().uuid(), loop: z.boolean().default(false) }).strict(),
  layerBaseSchema.extend({ type: z.literal("logo"), assetId: z.string().uuid() }).strict(),
  layerBaseSchema.extend({ type: z.literal("banner"), assetId: z.string().uuid() }).strict(),
  layerBaseSchema.extend({ type: z.literal("broll"), assetId: z.string().uuid(), muted: z.boolean().default(true) }).strict(),
  layerBaseSchema.extend({ type: z.literal("outro"), assetId: z.string().uuid() }).strict(),
]);

export const captionStyleSchema = z.object({
  preset: z.enum(["clean", "bold", "karaoke", "active_word", "word_pop", "minimal_box", "speaker_colors"]),
  fontAssetId: z.string().uuid().optional(),
  fontFamily: z.string().min(1).max(120),
  fontSizePx: z.number().int().min(16).max(180),
  fontWeight: z.number().int().min(100).max(900),
  uppercase: z.boolean(),
  maxWordsPerLine: z.number().int().min(1).max(12),
  maxLines: z.number().int().min(1).max(3),
  position: z.enum(["top", "center", "bottom"]),
  safeMarginPx: z.number().int().min(0).max(400),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  activeColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  outlineColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  outlinePx: z.number().min(0).max(16),
  background: z.boolean(),
}).strict();

export const captionTrackSchema = z.object({
  enabled: z.boolean(),
  language: z.string().min(2).max(32),
  words: z.array(z.object({
    wordId: z.string().min(1).max(160),
    displayText: z.string().max(240).optional(),
    hidden: z.boolean(),
    /** Remove this word's source interval from the media, not just captions. */
    cutFromMedia: z.boolean().default(false),
    speakerOverride: z.string().max(120).optional(),
  }).strict()).max(40_000),
  style: captionStyleSchema,
}).strict();

export const audioPolicySchema = z.object({
  sourceCuts: z.array(z.object({
    sourceId: z.string().uuid(),
    sourceRange: timeRangeUsSchema,
    reason: z.enum(["user", "pause", "filler"]),
  }).strict()).max(10_000),
  pauseRemoval: z.object({
    enabled: z.boolean(),
    minimumUs: z.number().int().nonnegative(),
    beforePaddingUs: z.number().int().nonnegative(),
    afterPaddingUs: z.number().int().nonnegative(),
    crossfadeUs: z.number().int().nonnegative(),
  }).strict(),
  loudness: z.object({ targetLufs: z.number().min(-30).max(-6), truePeakDb: z.number().min(-12).max(0) }).strict(),
}).strict();

export const exportProfileSchema = z.object({
  width: z.number().int().positive().max(4_096),
  height: z.number().int().positive().max(4_096),
  fps: z.number().int().min(24).max(60),
  videoCodec: z.enum(["h264"]),
  audioCodec: z.enum(["aac"]),
  videoBitrateKbps: z.number().int().min(500).max(25_000),
  audioBitrateKbps: z.number().int().min(64).max(512),
  watermark: z.boolean(),
}).strict();

export const clipDocumentV2Schema = z.object({
  schemaVersion: z.literal(2),
  clipId: z.string().uuid(),
  sourceRefs: z.array(sourceRefSchema).min(1).max(8),
  timebase: z.object({ ticksPerSecond: z.literal(HVE_TICKS_PER_SECOND), frameRate: rationalSchema }).strict(),
  narrative: z.array(narrativeSegmentSchema).min(1).max(200),
  layout: z.array(layoutSegmentSchema).min(1).max(500),
  captions: captionTrackSchema,
  layers: z.array(productionLayerSchema).max(32),
  audio: audioPolicySchema,
  export: exportProfileSchema,
  styleVersionId: z.string().uuid(),
  analysisId: z.string().uuid(),
  plannerVersion: z.string().min(1).max(120),
  rendererVersion: z.string().min(1).max(120),
}).strict().superRefine((value, context) => {
  const knownSources = new Set(value.sourceRefs.map((source) => source.sourceId));
  const orders = new Set<number>();
  for (const segment of value.narrative) {
    if (!knownSources.has(segment.sourceId)) {
      context.addIssue({ code: "custom", message: "Narrative source must be listed in sourceRefs", path: ["narrative"] });
    }
    if (orders.has(segment.order)) {
      context.addIssue({ code: "custom", message: "Narrative order values must be unique", path: ["narrative"] });
    }
    orders.add(segment.order);
  }
});

/**
 * One affine mapping from source to output time. `rate` means source-time per
 * output-time: 1/1 is normal speed, 2/1 consumes two source microseconds for
 * every one output microsecond. HVE-2 currently emits only 1/1 mappings but
 * keeps the rational form so a future speed policy remains deterministic.
 */
export const timeMapEntrySchema = z.object({
  sourceRange: timeRangeUsSchema,
  outputRange: timeRangeUsSchema,
  sourceId: z.string().uuid(),
  rate: rationalSchema,
  /**
   * The incoming segment overlaps the prior output segment by this many
   * microseconds. It is deliberately part of the canonical output clock:
   * video, audio, captions and the final duration all observe the same
   * overlap. Omitted means a normal hard cut, retaining compatibility with
   * already persisted HVE-2 documents.
   */
  transitionInUs: z.number().int().nonnegative().max(500_000).optional(),
}).strict();

export const timeMapSchema = z.array(timeMapEntrySchema).min(1).max(20_000).superRefine((entries, context) => {
  let previous: z.infer<typeof timeMapEntrySchema> | undefined;
  for (const [index, entry] of entries.entries()) {
    const sourceDuration = entry.sourceRange.endUs - entry.sourceRange.startUs;
    const outputDuration = entry.outputRange.endUs - entry.outputRange.startUs;
    const transitionInUs = entry.transitionInUs ?? 0;
    if (!previous && transitionInUs !== 0) {
      context.addIssue({ code: "custom", path: [index, "transitionInUs"], message: "The first time-map entry cannot transition from an earlier output segment" });
    }
    if (previous) {
      const previousOutputDuration = previous.outputRange.endUs - previous.outputRange.startUs;
      if (transitionInUs >= previousOutputDuration || transitionInUs >= outputDuration) {
        context.addIssue({ code: "custom", path: [index, "transitionInUs"], message: "A transition must be shorter than both adjacent output segments" });
      }
    }
    const expectedOutputStart = previous
      ? previous.outputRange.endUs - transitionInUs
      : 0;
    if (entry.outputRange.startUs !== expectedOutputStart) {
      context.addIssue({ code: "custom", path: [index, "outputRange"], message: "Time-map output ranges must begin at zero and may overlap only by transitionInUs" });
    }
    // Exact integer arithmetic is intentional. A plan with a fractional
    // microsecond cannot have the same caption/audio/video timing everywhere.
    if (outputDuration * entry.rate.numerator !== sourceDuration * entry.rate.denominator) {
      context.addIssue({ code: "custom", path: [index, "rate"], message: "Time-map rate must map source and output durations exactly" });
    }
    previous = entry;
  }
});

export const plannedCaptionWordSchema = z.object({
  wordId: z.string().min(1).max(160),
  /** Render text after transcript overrides, already normalized by the planner. */
  text: z.string().min(1).max(240),
  outputRange: timeRangeUsSchema,
  speakerId: z.string().max(120).optional(),
}).strict();

export const captionCuePlanSchema = z.object({
  outputRange: timeRangeUsSchema,
  lines: z.array(z.string().min(1).max(240)).min(1).max(3),
  activeWordIds: z.array(z.string().min(1).max(160)).max(24),
  words: z.array(plannedCaptionWordSchema).min(1).max(36),
}).strict();

export const captionPlanSchema = z.object({
  cues: z.array(captionCuePlanSchema).max(20_000),
  warnings: z.array(engineWarningSchema).max(1_000).default([]),
}).strict();

/**
 * A production layer is resolved before it reaches a renderer.  In
 * particular, a renderer does not receive style names from the product UI and
 * decide what they mean at render time.  HVE-3 initially has one executable
 * kind: a text title with an explicit, versioned style payload. Static image
 * assets are admitted only with their immutable content hash and MIME type;
 * the worker receives the private storage locator separately from this
 * canonical plan. A verified `video` layer is a muted visual overlay only.
 * A verified `broll` layer is a separate, full-canvas visual replacement:
 * it keeps the narrative audio and can never extend or loop the clip clock.
 * Outro still has end-of-timeline semantics and deliberately remains locked
 * until its own planner exists.
 */
export const resolvedTextLayerPlanSchema = z.object({
  layerId: z.string().uuid(),
  type: z.literal("text"),
  outputRange: timeRangeUsSchema,
  destinationPx: rectPxSchema,
  opacity: z.number().min(0).max(1),
  zIndex: z.number().int().min(0).max(100),
  text: z.string().min(1).max(500),
  style: z.object({
    id: z.literal("hve-title-v1"),
    fontFamily: z.string().min(1).max(120),
    fontSizePx: z.number().int().min(16).max(240),
    fontWeight: z.number().int().min(100).max(900),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    outlineColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    outlinePx: z.number().min(0).max(24),
    background: z.boolean(),
  }).strict(),
}).strict();

export const resolvedStaticImageLayerPlanSchema = z.object({
  layerId: z.string().uuid(),
  type: z.enum(["image", "logo", "banner"]),
  outputRange: timeRangeUsSchema,
  destinationPx: rectPxSchema,
  opacity: z.number().min(0).max(1),
  zIndex: z.number().int().min(0).max(100),
  asset: z.object({
    assetId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    byteSize: z.number().int().positive().max(25 * 1024 * 1024),
  }).strict(),
  /** Static assets preserve their aspect ratio inside the resolved box. */
  fit: z.literal("contain"),
}).strict();

/** A bounded, fully-decoded H.264/yuv420p overlay. Its source audio is never
 * mapped into a clip in this first timed-layer release. */
export const resolvedTimedVideoLayerPlanSchema = z.object({
  layerId: z.string().uuid(),
  type: z.literal("video"),
  outputRange: timeRangeUsSchema,
  destinationPx: rectPxSchema,
  opacity: z.number().min(0).max(1),
  zIndex: z.number().int().min(0).max(100),
  asset: z.object({
    assetId: z.string().uuid(),
    kind: z.literal("video"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    mimeType: z.literal("video/mp4"),
    byteSize: z.number().int().positive().max(100 * 1024 * 1024),
    durationMs: z.number().int().min(40).max(120_000),
    profile: z.literal("hve-timed-visual-h264-aac-v1"),
    audioPolicy: z.literal("muted_until_timed_audio_is_implemented"),
  }).strict(),
  loop: z.boolean(),
  /** Timed video preserves aspect ratio inside its planner-owned box. */
  fit: z.literal("contain"),
}).strict();

/**
 * B-roll is intentionally not a generic overlay with a friendlier label.
 * It replaces the full visual canvas only for a bounded output-clock range,
 * keeps the clip's already-planned narrative audio, and cannot loop.  The
 * strict geometry and z-index reserve captions/titles/brand overlays for
 * their normal compositor order.
 */
export const resolvedBrollLayerPlanSchema = z.object({
  layerId: z.string().uuid(),
  type: z.literal("broll"),
  outputRange: timeRangeUsSchema,
  destinationPx: rectPxSchema,
  opacity: z.literal(1),
  zIndex: z.number().int().min(0).max(5),
  asset: z.object({
    assetId: z.string().uuid(),
    kind: z.literal("broll"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    mimeType: z.literal("video/mp4"),
    byteSize: z.number().int().positive().max(100 * 1024 * 1024),
    durationMs: z.number().int().min(40).max(120_000),
    profile: z.literal("hve-timed-visual-h264-aac-v1"),
    audioPolicy: z.literal("muted_until_timed_audio_is_implemented"),
  }).strict(),
  muted: z.literal(true),
  visualPolicy: z.literal("replace_full_canvas_keep_narrative_audio"),
  fit: z.literal("cover"),
}).strict();

export const resolvedLayerPlanSchema = z.discriminatedUnion("type", [
  resolvedTextLayerPlanSchema,
  resolvedStaticImageLayerPlanSchema,
  resolvedTimedVideoLayerPlanSchema,
  resolvedBrollLayerPlanSchema,
]);

export const resolvedRenderPlanSchema = z.object({
  schemaVersion: z.literal(1),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().int().min(24).max(60) }).strict(),
  timeMap: timeMapSchema,
  layoutSegments: z.array(z.object({
    outputRange: timeRangeUsSchema,
    slots: z.array(z.object({
      destinationPx: rectPxSchema,
      source: regionRefSchema,
      fit: z.enum(["cover", "contain", "smart_cover"]),
      cropKeyframes: z.array(z.object({ atUs: timeUsSchema, crop: normalizedRectSchema, confidence: z.number().min(0).max(1).optional() }).strict()).max(20_000),
      cornerRadiusPx: z.number().int().nonnegative(),
      background: z.enum(["transparent", "blur", "solid"]).optional(),
    }).strict()).min(1).max(4),
    transition: z.enum(["cut", "crossfade"]).optional(),
  }).strict()).max(500),
  captionPlan: captionPlanSchema,
  /** The font is resolved before a job enters the queue; the worker must not
   * choose a host fallback from a user-provided CSS family name. */
  fontPlan: hveFontPlanSchema,
  layerPlan: z.array(resolvedLayerPlanSchema).max(64),
  audioPlan: z.object({ timeMap: timeMapSchema, targetLufs: z.number(), truePeakDb: z.number() }).strict(),
  warnings: z.array(engineWarningSchema).max(1_000),
  dependencies: z.array(artifactRefSchema).max(1_000),
}).strict();

export const clipDraftV2Schema = z.object({
  clipId: z.string().uuid(),
  baseVersion: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  document: clipDocumentV2Schema,
  updatedAt: z.string().datetime(),
  updatedBy: z.string().uuid(),
}).strict();

/**
 * Metadata is versioned with an HVE draft, but intentionally sits outside the
 * media document. A social title does not change pixels and must not cause a
 * media-plan cache miss; it still needs the same optimistic-concurrency and
 * audit guarantees as a caption or crop change.
 */
export const clipDraftMetadataSchema = z.object({
  title: z.string().trim().min(1).max(240),
  socialTitle: z.string().trim().max(240).nullable(),
  socialDescription: z.string().trim().max(5_000).nullable(),
}).strict();

export const clipDraftMetadataPatchSchema = clipDraftMetadataSchema.partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "A metadata command must change at least one field.",
  });

/** The visible caption track is distinct from its visual style. */
export const captionTrackPatchSchema = z.object({
  enabled: z.boolean().optional(),
  language: z.string().min(2).max(16).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, {
  message: "A caption track command must change at least one field.",
});

const editorCommandBaseSchema = z.object({
  commandId: z.string().uuid(),
  batchId: z.string().uuid(),
  clipId: z.string().uuid(),
  clientId: z.string().min(1).max(120),
  clientSequence: z.number().int().nonnegative(),
  baseRevision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

const userVerifiedFaceGridCommandSchema = editorCommandBaseSchema.extend({
  kind: z.literal("set_user_verified_face_grid"),
  layoutSegmentId: z.string().uuid(),
  template: z.enum(["grid_3", "grid_4"]),
  faceTrackIds: z.array(z.string().min(1).max(160)).min(3).max(4),
}).strict().superRefine((value, context) => {
  const expectedCount = value.template === "grid_3" ? 3 : 4;
  if (value.faceTrackIds.length !== expectedCount) {
    context.addIssue({
      code: "custom",
      path: ["faceTrackIds"],
      message: `${value.template} requires exactly ${expectedCount} face tracks.`,
    });
  }
});

const userVerifiedScreenCompositeCommandSchema = editorCommandBaseSchema.extend({
  kind: z.literal("set_user_verified_screen_composite"),
  layoutSegmentId: z.string().uuid(),
  template: z.enum(["gameplay_facecam", "screen_speaker", "picture_in_picture"]),
  screenCrop: normalizedRectSchema,
  faceTrackId: z.string().min(1).max(160),
}).strict();

export const editorCommandSchema = z.discriminatedUnion("kind", [
  editorCommandBaseSchema.extend({ kind: z.literal("replace_word"), wordId: z.string().min(1).max(160), displayText: z.string().min(1).max(240) }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("clear_word_display"), wordId: z.string().min(1).max(160) }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_word_visibility"), wordIds: z.array(z.string().min(1).max(160)).min(1).max(500), hidden: z.boolean() }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("cut_words"), wordIds: z.array(z.string().min(1).max(160)).min(1).max(500), cut: z.boolean() }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("trim_narrative"), segmentId: z.string().uuid(), sourceRange: timeRangeUsSchema }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("reorder_narrative"), orderedSegmentIds: z.array(z.string().uuid()).min(1).max(200) }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_layout"), anchor: segmentAnchorRangeSchema, template: z.string().min(1).max(80), slots: z.array(slotAssignmentSchema).min(1).max(4).optional() }).strict(),
  /**
   * HVE-6 deliberately has a narrow command for multi-person grids. The
   * client supplies only an ordered set of user-verified face tracks; the
   * registry builds geometry and source bindings from the immutable document.
   * This prevents a UI from manufacturing arbitrary tracked slots.
   */
  userVerifiedFaceGridCommandSchema,
  /** Same bounded path for a manually confirmed gameplay/screen region. */
  userVerifiedScreenCompositeCommandSchema,
  editorCommandBaseSchema.extend({ kind: z.literal("set_layout_lock"), layoutSegmentId: z.string().uuid(), locked: z.boolean() }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_manual_crop"), layoutSegmentId: z.string().uuid(), slotId: z.string().min(1).max(80), crop: normalizedRectSchema.nullable() }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_crop_track"), layoutSegmentId: z.string().uuid(), slotId: z.string().min(1).max(80), analysisId: z.string().uuid(), trackId: z.string().min(1).max(160) }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("add_layer"), layer: productionLayerSchema }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("remove_layer"), layerId: z.string().uuid() }).strict(),
  /** Update the executable properties of an existing text layer. Asset layers
   * deliberately use separate commands: their lifecycle requires verified S3
   * bytes and must never be represented by an arbitrary browser URL. */
  editorCommandBaseSchema.extend({
    kind: z.literal("set_text_layer"),
    layerId: z.string().uuid(),
    patch: z.object({
      text: z.string().min(1).max(500).optional(),
      anchor: z.enum(["top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"]).optional(),
      box: normalizedRectSchema.optional(),
    }).strict().refine((patch) => Object.keys(patch).length > 0, { message: "A text layer command must change at least one property." }),
  }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_caption_track"), patch: captionTrackPatchSchema }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_caption_style"), patch: captionStyleSchema.partial().strict() }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_audio_policy"), patch: audioPolicySchema.partial().strict() }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_export_profile"), profile: exportProfileSchema }).strict(),
  editorCommandBaseSchema.extend({ kind: z.literal("set_clip_metadata"), patch: clipDraftMetadataPatchSchema }).strict(),
]);

export const engineCapabilitySchema = z.object({
  engineVersion: z.string().min(1).max(120),
  plannerVersion: z.string().min(1).max(120),
  rendererVersion: z.string().min(1).max(120),
  jobClasses: z.array(z.enum(["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"])).min(1),
  models: z.record(z.string(), z.string().min(1).max(160)).default({}),
  memoryBytes: z.number().int().positive(),
  scratchFreeBytes: z.number().int().nonnegative(),
  heavySlots: z.number().int().min(0).max(8),
  mediumSlots: z.number().int().min(0).max(8),
  // The current media worker executes one job loop. Keep the overall limit
  // explicit so capacity stays correct when more class-specific slots appear.
  maxConcurrentJobs: z.number().int().min(1).max(32).default(1),
  // Optional while v1 workers are still rolling. When requirements name a
  // concrete job type the scheduler fail-closes on workers that don't report
  // this field instead of leasing an unknown task.
  jobTypes: z.array(z.enum([
    "source_preview", "probe", "youtube_import", "extract_audio", "speech_to_text", "generate_proxy", "verify_brand_video",
    "find_moments", "analyze_visual", "analyze_clip_visual", "face_track", "render_clip",
    "validate_render", "zip_project", "cleanup",
  ])).min(1).optional(),
  stt: z.object({
    engine: z.string().min(1).max(120),
    model: z.string().min(1).max(160),
    // A worker may keep rendering available while its local STT pack is
    // intentionally unavailable. The scheduler must see that distinction
    // instead of leasing a transcript job that will fail after an audio
    // download.
    modelReady: z.boolean().default(false),
    device: z.string().min(1).max(80),
    computeType: z.string().min(1).max(80),
    wordTimestamps: z.boolean(),
    sileroVad: z.boolean(),
  }).strict().optional(),
  vision: z.record(z.string(), z.unknown()).optional(),
  subtitles: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const jobRequirementsSchema = z.object({
  engineVersion: z.string().min(1).max(120).optional(),
  requiredModels: z.record(z.string(), z.string().min(1).max(160)).default({}),
  minimumRamBytes: z.number().int().nonnegative().default(0),
  minimumScratchBytes: z.number().int().nonnegative().default(0),
  requiredClasses: z.array(z.enum(["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"])).min(1).default(["cpu_light"]),
  requiredJobTypes: z.array(z.enum([
    "source_preview", "probe", "youtube_import", "extract_audio", "speech_to_text", "generate_proxy", "verify_brand_video",
    "find_moments", "analyze_visual", "analyze_clip_visual", "face_track", "render_clip",
    "validate_render", "zip_project", "cleanup",
  ])).max(8).default([]),
  workspaceConcurrencyLimit: z.number().int().min(1).max(20).default(1),
}).strict();

export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type SourceAnalysisManifest = z.infer<typeof sourceAnalysisManifestSchema>;
export type ClipDocumentV2 = z.infer<typeof clipDocumentV2Schema>;
export type ResolvedRenderPlan = z.infer<typeof resolvedRenderPlanSchema>;
export type TimeMapEntry = z.infer<typeof timeMapEntrySchema>;
export type EngineWarning = z.infer<typeof engineWarningSchema>;
export type CaptionPlan = z.infer<typeof captionPlanSchema>;
export type ClipDraftV2 = z.infer<typeof clipDraftV2Schema>;
export type ClipDraftMetadata = z.infer<typeof clipDraftMetadataSchema>;
export type EditorCommand = z.infer<typeof editorCommandSchema>;
export type EngineCapability = z.infer<typeof engineCapabilitySchema>;
export type JobRequirements = z.infer<typeof jobRequirementsSchema>;

/** Object keys are sorted; all arrays retain their domain order. */
export function canonicalizeHve(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeHve).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeHve(object[key])}`).join(",")}}`;
}

export async function hashHve(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeHve(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

/** Transitional adapter. HVE-1 validates semantic import; v2 rendering starts only after HVE-3. */
export function importClipEdlV1ToDocumentV2(input: ClipEDL): ClipDocumentV2 {
  const edl = clipEdlSchema.parse(input);
  const startUs = edl.range.startMs * 1_000;
  const endUs = edl.range.endMs * 1_000;
  return clipDocumentV2Schema.parse({
    schemaVersion: 2,
    clipId: crypto.randomUUID(),
    sourceRefs: [{ sourceId: edl.sourceId, sourceHash: edl.sourceHash }],
    timebase: { ticksPerSecond: HVE_TICKS_PER_SECOND, frameRate: { numerator: edl.export.fps, denominator: 1 } },
    narrative: [{
      id: crypto.randomUUID(), sourceId: edl.sourceId, sourceRange: { startUs, endUs }, enabled: true, order: 0,
      transcriptWordIds: [], transitionIn: "cut", transitionOut: "cut",
    }],
    layout: [{
      id: crypto.randomUUID(), anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
      template: edl.layout.mode, slots: [{
        slotId: "primary", regionRef: { analysisId: crypto.randomUUID(), trackId: "v1-source", kind: "source" },
        fit: edl.layout.mode === "blur_background" ? "contain" : "cover",
      }], provenance: { origin: "style", reasonCode: "V1_EDL_IMPORT" }, lockedByUser: false,
    }],
    captions: {
      enabled: edl.subtitles.enabled, language: "ru", words: edl.transcriptEdits.map((edit) => ({
        wordId: edit.wordRef, displayText: edit.displayText, hidden: edit.hiddenFromSubtitles,
        cutFromMedia: edit.cutFromMedia,
      })), style: {
        preset: edl.subtitles.preset === "pulse" ? "word_pop" : edl.subtitles.preset,
        fontAssetId: edl.subtitles.fontAssetId, fontFamily: edl.subtitles.fontFamily, fontSizePx: edl.subtitles.fontSize,
        fontWeight: edl.subtitles.fontWeight, uppercase: edl.subtitles.uppercase,
        maxWordsPerLine: edl.subtitles.maxWordsPerLine, maxLines: edl.subtitles.maxLines,
        position: edl.subtitles.position, safeMarginPx: edl.subtitles.safeMarginPx,
        color: edl.subtitles.color, activeColor: edl.subtitles.activeColor,
        outlineColor: edl.subtitles.outlineColor, outlinePx: edl.subtitles.outlinePx,
        background: edl.subtitles.background,
      },
    },
    // A v1 layer without its required content is omitted rather than being
    // converted to a fake asset or empty text layer. This keeps imports
    // truthful: the v2 document can only reference an asset that exists.
    layers: [
      ...(edl.title?.text?.trim() ? [{
        id: crypto.randomUUID(), type: "text" as const,
        anchorRange: { start: { kind: "clip_start" as const }, end: { kind: "clip_end" as const, offsetUs: 0 } },
        followPolicy: "follow_narrative" as const, zIndex: 10, anchor: edl.title.anchor,
        box: { x: 0.05, y: 0.05, width: Math.min(edl.title.widthPercent / 100, 0.9), height: 0.18 },
        opacity: edl.title.opacity, collisionPolicy: "warn" as const,
        text: edl.title.text.trim(), styleRef: "v1-title",
      }] : []),
      ...(edl.logo?.assetId ? [{
        id: crypto.randomUUID(), type: "logo" as const,
        anchorRange: { start: { kind: "clip_start" as const }, end: { kind: "clip_end" as const, offsetUs: 0 } },
        followPolicy: "follow_narrative" as const, zIndex: 11, anchor: edl.logo.anchor,
        box: { x: 0.05, y: 0.05, width: Math.min(edl.logo.widthPercent / 100, 0.9), height: 0.18 },
        opacity: edl.logo.opacity, collisionPolicy: "warn" as const, assetId: edl.logo.assetId,
      }] : []),
      ...(edl.banner?.assetId ? [{
        id: crypto.randomUUID(), type: "banner" as const,
        anchorRange: { start: { kind: "clip_start" as const }, end: { kind: "clip_end" as const, offsetUs: 0 } },
        followPolicy: "follow_narrative" as const, zIndex: 12, anchor: edl.banner.anchor,
        box: { x: 0.05, y: 0.05, width: Math.min(edl.banner.widthPercent / 100, 0.9), height: 0.18 },
        opacity: edl.banner.opacity, collisionPolicy: "warn" as const, assetId: edl.banner.assetId,
      }] : []),
    ],
    audio: {
      sourceCuts: edl.cuts.map((cut) => ({ sourceId: edl.sourceId, sourceRange: { startUs: cut.startMs * 1_000, endUs: cut.endMs * 1_000 }, reason: "user" as const })),
      pauseRemoval: {
        enabled: edl.silence.enabled, minimumUs: edl.silence.minimumMs * 1_000,
        beforePaddingUs: edl.silence.beforePaddingMs * 1_000, afterPaddingUs: edl.silence.afterPaddingMs * 1_000,
        crossfadeUs: edl.silence.crossfadeMs * 1_000,
      }, loudness: { targetLufs: -14, truePeakDb: -1 },
    },
    export: edl.export,
    styleVersionId: edl.styleVersionId,
    analysisId: crypto.randomUUID(),
    plannerVersion: "hve-v2-import-1",
    rendererVersion: edl.rendererVersion,
  });
}
