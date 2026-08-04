import {
  clipDocumentV2Schema,
  engineWarningSchema,
  normalizedRectSchema,
  timeMapSchema,
  timeRangeUsSchema,
  type CaptionPlan,
  type ClipDocumentV2,
  type EngineWarning,
  type TimeMapEntry,
} from "./hve-v2.js";
import type { TimingTranscriptWord } from "./hve-time-map.js";
import { hveSceneGraphSchema, type HveSceneGraph } from "./hve-perception.js";

/**
 * HVE-3 layout planning is a data registry, not a pile of renderer branches.
 * The same resolved slots will later compile to Canvas/WebGL in the browser and
 * native FFmpeg filters on the worker. Values are normalized only here, then
 * rounded once at the export canvas boundary.
 */
export const layoutTemplateIds = [
  "portrait_focus",
  "blur_background",
  "split_top_bottom",
  "split_left_right",
  "screen_speaker",
  "gameplay_facecam",
  "picture_in_picture",
  "grid_3",
  "grid_4",
] as const;

export type LayoutTemplateId = (typeof layoutTemplateIds)[number];
type TemplateSlot = {
  id: string;
  destination: { x: number; y: number; width: number; height: number };
  background?: "transparent" | "blur" | "solid";
  cornerRadiusRatio?: number;
};
export type LayoutTemplate = {
  id: LayoutTemplateId;
  slots: readonly TemplateSlot[];
};

const define = (template: LayoutTemplate): LayoutTemplate => {
  for (const slot of template.slots) normalizedRectSchema.parse(slot.destination);
  return template;
};

/** The first production registry. Add a new layout by data + fixtures, never an ad-hoc renderer condition. */
export const layoutTemplateRegistry: Record<LayoutTemplateId, LayoutTemplate> = {
  portrait_focus: define({
    id: "portrait_focus",
    slots: [{ id: "primary", destination: { x: 0, y: 0, width: 1, height: 1 } }],
  }),
  blur_background: define({
    id: "blur_background",
    slots: [{ id: "primary", destination: { x: 0, y: 0, width: 1, height: 1 }, background: "blur" }],
  }),
  split_top_bottom: define({
    id: "split_top_bottom",
    slots: [
      { id: "primary", destination: { x: 0, y: 0, width: 1, height: 0.5 } },
      { id: "secondary", destination: { x: 0, y: 0.5, width: 1, height: 0.5 } },
    ],
  }),
  split_left_right: define({
    id: "split_left_right",
    slots: [
      { id: "primary", destination: { x: 0, y: 0, width: 0.5, height: 1 } },
      { id: "secondary", destination: { x: 0.5, y: 0, width: 0.5, height: 1 } },
    ],
  }),
  screen_speaker: define({
    id: "screen_speaker",
    slots: [
      { id: "screen", destination: { x: 0, y: 0, width: 1, height: 0.7 } },
      { id: "speaker", destination: { x: 0, y: 0.7, width: 1, height: 0.3 } },
    ],
  }),
  gameplay_facecam: define({
    id: "gameplay_facecam",
    slots: [
      { id: "facecam", destination: { x: 0, y: 0, width: 1, height: 0.3 } },
      { id: "gameplay", destination: { x: 0, y: 0.3, width: 1, height: 0.7 } },
    ],
  }),
  picture_in_picture: define({
    id: "picture_in_picture",
    slots: [
      { id: "primary", destination: { x: 0, y: 0, width: 1, height: 1 } },
      { id: "secondary", destination: { x: 0.62, y: 0.06, width: 0.32, height: 0.24 }, cornerRadiusRatio: 0.04 },
    ],
  }),
  grid_3: define({
    id: "grid_3",
    slots: [
      { id: "primary", destination: { x: 0, y: 0, width: 1, height: 0.5 } },
      { id: "secondary", destination: { x: 0, y: 0.5, width: 0.5, height: 0.5 } },
      { id: "tertiary", destination: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
    ],
  }),
  grid_4: define({
    id: "grid_4",
    slots: [
      { id: "primary", destination: { x: 0, y: 0, width: 0.5, height: 0.5 } },
      { id: "secondary", destination: { x: 0.5, y: 0, width: 0.5, height: 0.5 } },
      { id: "tertiary", destination: { x: 0, y: 0.5, width: 0.5, height: 0.5 } },
      { id: "quaternary", destination: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
    ],
  }),
};

export class HveLayoutPlanningError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HveLayoutPlanningError";
  }
}

export type ResolvedLayoutSegment = {
  outputRange: { startUs: number; endUs: number };
  slots: Array<{
    destinationPx: { x: number; y: number; width: number; height: number };
    source: ClipDocumentV2["layout"][number]["slots"][number]["regionRef"];
    fit: "cover" | "contain" | "smart_cover";
    cropKeyframes: Array<{ atUs: number; crop: { x: number; y: number; width: number; height: number } }>;
    cornerRadiusPx: number;
    background?: "transparent" | "blur" | "solid";
  }>;
};

export type ResolvedProductionTextLayer = {
  layerId: string;
  type: "text";
  outputRange: { startUs: number; endUs: number };
  destinationPx: { x: number; y: number; width: number; height: number };
  opacity: number;
  zIndex: number;
  text: string;
  style: {
    id: "hve-title-v1";
    fontFamily: string;
    fontSizePx: number;
    fontWeight: number;
    color: string;
    outlineColor: string;
    outlinePx: number;
    background: boolean;
  };
};

export type ResolvedStaticImageLayer = {
  layerId: string;
  type: "image" | "logo" | "banner";
  outputRange: { startUs: number; endUs: number };
  destinationPx: { x: number; y: number; width: number; height: number };
  opacity: number;
  zIndex: number;
  asset: {
    assetId: string;
    sha256: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    byteSize: number;
  };
  fit: "contain";
};

/**
 * The initial timed layer is intentionally just a visual overlay. Its audio
 * never enters the clip clock, so an uploaded video cannot silently change a
 * user's speech, music or loudness result.
 */
export type ResolvedTimedVideoLayer = {
  layerId: string;
  type: "video";
  outputRange: { startUs: number; endUs: number };
  destinationPx: { x: number; y: number; width: number; height: number };
  opacity: number;
  zIndex: number;
  asset: {
    assetId: string;
    kind: "video";
    sha256: string;
    mimeType: "video/mp4";
    byteSize: number;
    durationMs: number;
    profile: "hve-timed-visual-h264-aac-v1";
    audioPolicy: "muted_until_timed_audio_is_implemented";
  };
  loop: boolean;
  fit: "contain";
};

/**
 * A bounded B-roll replacement. Unlike a `video` overlay, this occupies the
 * complete canvas, covers (rather than contains) it, has no source audio and
 * never loops. The narrative audio/time map remains the sole audio clock.
 */
export type ResolvedBrollLayer = {
  layerId: string;
  type: "broll";
  outputRange: { startUs: number; endUs: number };
  destinationPx: { x: number; y: number; width: number; height: number };
  opacity: 1;
  zIndex: number;
  asset: {
    assetId: string;
    kind: "broll";
    sha256: string;
    mimeType: "video/mp4";
    byteSize: number;
    durationMs: number;
    profile: "hve-timed-visual-h264-aac-v1";
    audioPolicy: "muted_until_timed_audio_is_implemented";
  };
  muted: true;
  visualPolicy: "replace_full_canvas_keep_narrative_audio";
  fit: "cover";
};

/** Only resolved executable layers are allowed into the first compositor. */
export type ResolvedProductionLayer = ResolvedProductionTextLayer | ResolvedStaticImageLayer | ResolvedTimedVideoLayer | ResolvedBrollLayer;

/**
 * The control plane creates this from a workspace-scoped brand asset joined to
 * its immutable media object.  Keeping the lookup interface in contracts
 * makes the layout compiler pure and prevents an asset URL from entering the
 * document or the render hash.
 */
export type HveStaticAsset = ResolvedStaticImageLayer["asset"];
export type HveTimedVideoAsset = ResolvedTimedVideoLayer["asset"];
export type HveBrollAsset = ResolvedBrollLayer["asset"];
export type HveProductionAsset = HveStaticAsset | HveTimedVideoAsset | HveBrollAsset;
export type HveAssetResolver = {
  get(assetId: string): HveProductionAsset | undefined;
};
/** Kept as a source-compatible name for first-party callers during HVE-3. */
export type HveStaticAssetResolver = HveAssetResolver;

function isStaticAsset(asset: HveProductionAsset): asset is HveStaticAsset {
  return asset.mimeType === "image/png" || asset.mimeType === "image/jpeg" || asset.mimeType === "image/webp";
}

function isVerifiedTimedVisualAsset(asset: HveProductionAsset): asset is HveTimedVideoAsset | HveBrollAsset {
  return asset.mimeType === "video/mp4";
}

type SlotAssignment = ClipDocumentV2["layout"][number]["slots"][number];

/**
 * HVE-6's first composite is intentionally user-verified, not a claim that a
 * generic CV pass recognised a game window or slide deck. The editor supplies
 * the screen/gameplay crop after the user has selected it; the face slot can
 * then consume a separately verified HVE-5 face track. Both slots still refer
 * to the single source, so the generic compositor remains layout-agnostic.
 */
export type UserVerifiedScreenComposite = {
  template: "gameplay_facecam" | "screen_speaker" | "picture_in_picture";
  /** A user-selected source crop that contains the screen or gameplay area. */
  screenCrop: { x: number; y: number; width: number; height: number };
  /** A face/facecam track from the document's exact verified analysis. */
  faceTrackId: string;
};

/**
 * A deliberately explicit layout for a panel or group podcast.  It is not a
 * speaker detector: the user (or a later, separately verified director
 * capability) selects the face tracks and assigns their order.  This keeps a
 * 3–4 person grid deterministic when people cross, leave frame, or a screen
 * share appears in the recording.
 */
export type UserVerifiedFaceGridComposite = {
  template: "grid_3" | "grid_4";
  /** Ordered to match the visible template slots, never inferred by render. */
  faceTrackIds: readonly string[];
};

export function buildUserVerifiedScreenCompositeSlots(
  documentInput: ClipDocumentV2,
  input: UserVerifiedScreenComposite,
): SlotAssignment[] {
  const document = clipDocumentV2Schema.parse(documentInput);
  const screenCrop = normalizedRectSchema.parse(input.screenCrop);
  if (document.sourceRefs.length !== 1) {
    throw new HveLayoutPlanningError(
      "HVE6_MULTI_SOURCE_COMPOSITE_UNSUPPORTED",
      "The first screen composite needs one source with a manually selected screen area.",
    );
  }
  const sourceRegion = (trackId: string): SlotAssignment["regionRef"] => ({
    analysisId: document.analysisId,
    trackId,
    kind: "source",
  });
  const faceSlot = (slotId: string): SlotAssignment => ({
    slotId,
    regionRef: sourceRegion("source-facecam"),
    fit: "smart_cover",
    cropTrack: { analysisId: document.analysisId, trackId: input.faceTrackId },
  });
  const screenSlot = (slotId: string): SlotAssignment => ({
    slotId,
    regionRef: sourceRegion("source-screen"),
    // Contain preserves a slide/game screen rather than silently cropping
    // important UI at the destination boundary.
    fit: "contain",
    manualCrop: screenCrop,
  });
  switch (input.template) {
    case "gameplay_facecam":
      return [faceSlot("facecam"), screenSlot("gameplay")];
    case "screen_speaker":
      return [screenSlot("screen"), faceSlot("speaker")];
    case "picture_in_picture":
      return [screenSlot("primary"), faceSlot("secondary")];
  }
}

export function buildUserVerifiedFaceGridSlots(
  documentInput: ClipDocumentV2,
  input: UserVerifiedFaceGridComposite,
): SlotAssignment[] {
  const document = clipDocumentV2Schema.parse(documentInput);
  if (document.sourceRefs.length !== 1) {
    throw new HveLayoutPlanningError(
      "HVE6_MULTI_SOURCE_COMPOSITE_UNSUPPORTED",
      "Первый grid-макет поддерживает один исходник с подтверждёнными треками лиц.",
    );
  }
  const template = layoutTemplateRegistry[input.template];
  if (input.faceTrackIds.length !== template.slots.length
    || input.faceTrackIds.some((trackId) => !trackId.trim())
    || new Set(input.faceTrackIds).size !== input.faceTrackIds.length) {
    throw new HveLayoutPlanningError(
      "HVE6_GRID_TRACKS_INVALID",
      `Для ${input.template} нужны ${template.slots.length} разных подтверждённых трека лица.`,
    );
  }
  return template.slots.map((templateSlot, index): SlotAssignment => ({
    slotId: templateSlot.id,
    regionRef: {
      analysisId: document.analysisId,
      trackId: `source-face-${index + 1}`,
      kind: "source",
    },
    fit: "smart_cover",
    cropTrack: { analysisId: document.analysisId, trackId: input.faceTrackIds[index]! },
  }));
}

/**
 * This is the only perception input the layout planner accepts. The caller
 * must load the immutable artifact by `analysisId` and verify it against the
 * source/version in the database before constructing this value. No renderer
 * is allowed to open a source and invent a crop on its own.
 */
export type HvePerceptionLayoutContext = {
  analysisId: string;
  graph: HveSceneGraph;
  source: { sourceId: string; sourceHash: string; width: number; height: number };
  /**
   * Bound by the source-analysis manifest, not inferred from the scene graph.
   * Older artifacts intentionally omit this field; they remain usable for the
   * conservative HVE-5 portrait fallback, but can never unlock an HVE-6
   * tracked facecam composite.
   */
  faceEvidence?: {
    density: "sparse" | "dense";
    coverage: Array<{ startUs: number; endUs: number }>;
  };
};

type Range = { startUs: number; endUs: number };

function clipDurationUs(timeMap: TimeMapEntry[]): number {
  return timeMap.at(-1)?.outputRange.endUs ?? 0;
}

function outputRangeForNarrative(document: ClipDocumentV2, timeMap: TimeMapEntry[], segmentId: string): Range {
  const narrative = document.narrative.find((segment) => segment.id === segmentId && segment.enabled);
  if (!narrative) throw new HveLayoutPlanningError("HVE_LAYOUT_NARRATIVE_NOT_FOUND", "Layout anchor refers to a missing narrative segment.");
  const entries = timeMap.filter((entry) => entry.sourceId === narrative.sourceId
    && entry.sourceRange.startUs >= narrative.sourceRange.startUs
    && entry.sourceRange.endUs <= narrative.sourceRange.endUs);
  if (!entries.length) throw new HveLayoutPlanningError("HVE_LAYOUT_NARRATIVE_REMOVED", "Layout anchor refers to media removed from the output timeline.");
  return { startUs: entries[0]!.outputRange.startUs, endUs: entries.at(-1)!.outputRange.endUs };
}

function resolveAnchor(
  anchor: ClipDocumentV2["layout"][number]["anchor"]["start"],
  document: ClipDocumentV2,
  timeMap: TimeMapEntry[],
  words: TimingTranscriptWord[],
): number {
  const durationUs = clipDurationUs(timeMap);
  if (anchor.kind === "clip_start") return 0;
  if (anchor.kind === "clip_end") return durationUs + anchor.offsetUs;
  if (anchor.kind === "narrative_offset") {
    const range = outputRangeForNarrative(document, timeMap, anchor.narrativeSegmentId);
    const value = range.startUs + anchor.offsetUs;
    if (value < range.startUs || value > range.endUs) throw new HveLayoutPlanningError("HVE_LAYOUT_NARRATIVE_OFFSET_OUT_OF_RANGE", "Layout anchor falls outside its narrative segment.");
    return value;
  }
  const word = words.find((candidate) => candidate.wordId === anchor.wordId);
  if (!word) throw new HveLayoutPlanningError("HVE_LAYOUT_WORD_NOT_FOUND", "Layout anchor refers to an unavailable transcript word.");
  const entry = timeMap.find((candidate) => candidate.sourceId === word.sourceId
    && candidate.sourceRange.startUs <= word.sourceRange.startUs
    && candidate.sourceRange.endUs >= word.sourceRange.endUs);
  if (!entry) throw new HveLayoutPlanningError("HVE_LAYOUT_WORD_REMOVED", "Layout anchor refers to text removed from the output timeline.");
  const sourceOffsetUs = (anchor.edge === "start" ? word.sourceRange.startUs : word.sourceRange.endUs) - entry.sourceRange.startUs;
  return entry.outputRange.startUs + sourceOffsetUs;
}

function rectToPixels(rect: TemplateSlot["destination"], width: number, height: number) {
  const x = Math.round(rect.x * width);
  const y = Math.round(rect.y * height);
  const right = Math.round((rect.x + rect.width) * width);
  const bottom = Math.round((rect.y + rect.height) * height);
  return { x, y, width: right - x, height: bottom - y };
}

type PixelRect = { x: number; y: number; width: number; height: number };
type OutputRange = { startUs: number; endUs: number };

function outputRangesOverlap(left: OutputRange, right: OutputRange) {
  return left.startUs < right.endUs && right.startUs < left.endUs;
}

function pixelRectsOverlap(left: PixelRect, right: PixelRect) {
  return left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height;
}

/**
 * libass reserves a fixed 60px horizontal margin and vertically anchors a
 * cue by its configured safe margin.  The exact glyph bounds depend on the
 * rendered text, but a planner must reserve a conservative envelope before a
 * job reaches FFmpeg; otherwise a title/banner can be known to cover every
 * subtitle yet the renderer has no opportunity to tell the user.
 */
function captionSafeRect(document: ClipDocumentV2): PixelRect | null {
  if (!document.captions.enabled) return null;
  const { width, height } = document.export;
  const style = document.captions.style;
  const horizontalMargin = Math.min(60, Math.floor(width / 3));
  const lineHeight = Math.ceil(style.fontSizePx * 1.35 + style.outlinePx * 2);
  const reservedHeight = Math.min(
    Math.max(1, height - style.safeMarginPx * 2),
    Math.max(1, lineHeight * style.maxLines + 12),
  );
  const maxY = Math.max(0, height - reservedHeight);
  const y = style.position === "top"
    ? Math.min(maxY, style.safeMarginPx)
    : style.position === "center"
      ? Math.round((height - reservedHeight) / 2)
      : Math.max(0, height - style.safeMarginPx - reservedHeight);
  return { x: horizontalMargin, y, width: Math.max(1, width - horizontalMargin * 2), height: reservedHeight };
}

function withinCanvas(rect: PixelRect, width: number, height: number) {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

function sameRect(left: PixelRect, right: PixelRect) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function chooseCaptionSafeMove(rect: PixelRect, blocked: PixelRect, canvas: { width: number; height: number }) {
  const candidates: PixelRect[] = [
    { ...rect, y: 0 },
    { ...rect, y: canvas.height - rect.height },
  ].filter((candidate, index, all) => (
    withinCanvas(candidate, canvas.width, canvas.height)
    && !pixelRectsOverlap(candidate, blocked)
    && all.findIndex((other) => sameRect(other, candidate)) === index
  ));
  candidates.sort((left, right) => {
    const leftDistance = Math.abs(left.x - rect.x) + Math.abs(left.y - rect.y);
    const rightDistance = Math.abs(right.x - rect.x) + Math.abs(right.y - rect.y);
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  });
  return candidates[0] ?? null;
}

/**
 * Collision policy is resolved once, before hashing the immutable render
 * input.  `move` is deliberately conservative: it only moves vertically to a
 * fully clear canvas edge.  It never guesses a position around a face, which
 * would turn a subtitle-safety mechanism into unverified composition logic.
 */
function applyCaptionCollisionPolicy(
  document: ClipDocumentV2,
  captionPlan: CaptionPlan | undefined,
  layers: ResolvedProductionLayer[],
  warnings: EngineWarning[],
) {
  const safeRect = captionSafeRect(document);
  if (!safeRect || !captionPlan?.cues.length) return layers;
  const policyByLayerId = new Map(document.layers.map((layer) => [layer.id, layer.collisionPolicy]));
  return layers.map((layer) => {
    // Full-canvas B-roll intentionally sits under captions and is not a
    // collision. It has a separate z-index/visual-policy contract.
    if (layer.type === "broll") return layer;
    const hasCaptionCollision = captionPlan.cues.some((cue) => (
      outputRangesOverlap(layer.outputRange, cue.outputRange)
      && pixelRectsOverlap(layer.destinationPx, safeRect)
    ));
    if (!hasCaptionCollision) return layer;
    const policy = policyByLayerId.get(layer.layerId) ?? "warn";
    if (policy === "allow") return layer;
    if (policy === "move") {
      const moved = chooseCaptionSafeMove(layer.destinationPx, safeRect, document.export);
      if (moved) {
        warnings.push(engineWarningSchema.parse({
          code: "HVE_LAYER_CAPTION_COLLISION_MOVED",
          range: layer.outputRange,
          requested: "move",
          applied: "moved_to_caption_safe_region",
          userMessage: "Элемент перемещён, чтобы не перекрывать субтитры в выбранном фрагменте.",
          severity: "warning",
        }));
        return { ...layer, destinationPx: moved };
      }
    }
    warnings.push(engineWarningSchema.parse({
      code: "HVE_LAYER_CAPTION_COLLISION",
      range: layer.outputRange,
      requested: policy,
      applied: "warn",
      userMessage: "Элемент пересекается с безопасной зоной субтитров. Измените позицию, размер или время показа.",
      severity: "warning",
    }));
    return layer;
  });
}

/**
 * Convert product-owned production layers to renderer data.  The first
 * executable style is intentionally small and explicit.  It makes a V2 title
 * real without pretending that image/video asset references can already be
 * rendered before an asset ownership/hash resolver exists.
 */
export function resolveProductionLayers(
  documentInput: ClipDocumentV2,
  timeMapInput: TimeMapEntry[],
  transcriptWords: TimingTranscriptWord[] = [],
  assetResolver?: HveStaticAssetResolver,
  rendererFontFamily?: string,
  captionPlan?: CaptionPlan,
): { layers: ResolvedProductionLayer[]; warnings: EngineWarning[] } {
  const document = clipDocumentV2Schema.parse(documentInput);
  const timeMap = timeMapSchema.parse(timeMapInput);
  const durationUs = clipDurationUs(timeMap);
  const warnings: EngineWarning[] = [];
  const layers = document.layers.map((layer) => {
    const startUs = resolveAnchor(layer.anchorRange.start, document, timeMap, transcriptWords);
    const endUs = resolveAnchor(layer.anchorRange.end, document, timeMap, transcriptWords);
    if (startUs < 0 || endUs > durationUs || endUs <= startUs) {
      throw new HveLayoutPlanningError("HVE_LAYER_ANCHOR_RANGE_INVALID", "Production layer resolves outside the output timeline.");
    }
    if (layer.type !== "text") {
      if (layer.type === "video" || layer.type === "broll") {
        const asset = assetResolver?.get(layer.assetId);
        const layerDurationMs = Math.ceil((endUs - startUs) / 1_000);
        if (!asset) {
          throw new HveLayoutPlanningError(
            "HVE_LAYER_ASSET_RESOLVER_REQUIRED",
            "The selected timed asset is not available in this workspace.",
          );
        }
        if (
          !isVerifiedTimedVisualAsset(asset)
          || asset.mimeType !== "video/mp4"
          || asset.profile !== "hve-timed-visual-h264-aac-v1"
          || asset.audioPolicy !== "muted_until_timed_audio_is_implemented"
          || !Number.isInteger(asset.byteSize)
          || asset.byteSize <= 0
          || asset.byteSize > 100 * 1024 * 1024
          || !Number.isInteger(asset.durationMs)
          || asset.durationMs < 40
          || asset.durationMs > 120_000
        ) {
          throw new HveLayoutPlanningError(
            "HVE_LAYER_TIMED_ASSET_INVALID",
            "The selected timed asset has not completed the required worker verification.",
          );
        }
        if (asset.kind !== layer.type) {
          throw new HveLayoutPlanningError(
            "HVE_LAYER_TIMED_ASSET_KIND_MISMATCH",
            "The selected timed asset cannot be used for this production layer.",
          );
        }
        const destinationPx = rectToPixels(layer.box, document.export.width, document.export.height);
        if (layer.type === "broll") {
          if (asset.kind !== "broll") {
            throw new HveLayoutPlanningError(
              "HVE_LAYER_TIMED_ASSET_KIND_MISMATCH",
              "The selected timed asset cannot be used for B-roll.",
            );
          }
          if (!layer.muted) {
            throw new HveLayoutPlanningError(
              "HVE_BROLL_AUDIO_UNSUPPORTED",
              "B-roll audio is not available. Keep the narrative audio or remove this B-roll layer.",
            );
          }
          if (
            destinationPx.x !== 0 || destinationPx.y !== 0
            || destinationPx.width !== document.export.width || destinationPx.height !== document.export.height
          ) {
            throw new HveLayoutPlanningError(
              "HVE_BROLL_FULL_CANVAS_REQUIRED",
              "B-roll must replace the complete visual canvas for its selected time range.",
            );
          }
          if (layer.opacity !== 1 || layer.zIndex > 5) {
            throw new HveLayoutPlanningError(
              "HVE_BROLL_VISUAL_POLICY_INVALID",
              "B-roll must be opaque and remain below captions and foreground branding.",
            );
          }
          if (asset.durationMs < layerDurationMs) {
            throw new HveLayoutPlanningError(
              "HVE_BROLL_ASSET_TOO_SHORT",
              "B-roll is shorter than its output range. Shorten the range or choose another asset.",
            );
          }
          const brollAsset: HveBrollAsset = asset;
          return {
            layerId: layer.id,
            type: "broll" as const,
            outputRange: timeRangeUsSchema.parse({ startUs, endUs }),
            destinationPx,
            opacity: 1 as const,
            zIndex: layer.zIndex,
            asset: brollAsset,
            muted: true as const,
            visualPolicy: "replace_full_canvas_keep_narrative_audio" as const,
            fit: "cover" as const,
          };
        }
        if (asset.kind !== "video") {
          throw new HveLayoutPlanningError(
            "HVE_LAYER_TIMED_ASSET_KIND_MISMATCH",
            "The selected timed asset cannot be used for a video overlay.",
          );
        }
        const timedVideoAsset: HveTimedVideoAsset = asset;
        if (!layer.loop && asset.durationMs < layerDurationMs) {
          throw new HveLayoutPlanningError(
            "HVE_LAYER_TIMED_ASSET_TOO_SHORT",
            "The video layer is shorter than its output range. Enable loop or choose a shorter range.",
          );
        }
        return {
          layerId: layer.id,
          type: "video" as const,
          outputRange: timeRangeUsSchema.parse({ startUs, endUs }),
          destinationPx,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          asset: timedVideoAsset,
          loop: layer.loop,
          fit: "contain" as const,
        };
      }
      const staticLayerType = layer.type;
      if (staticLayerType !== "image" && staticLayerType !== "logo" && staticLayerType !== "banner") {
        throw new HveLayoutPlanningError(
          "HVE_LAYER_TYPE_UNSUPPORTED",
          "Outro layers are not available on this renderer release.",
        );
      }
      const asset = assetResolver?.get(layer.assetId);
      if (!asset) {
        throw new HveLayoutPlanningError(
          "HVE_LAYER_ASSET_RESOLVER_REQUIRED",
          "The selected brand asset is not available in this workspace.",
        );
      }
      if (!isStaticAsset(asset)) {
        throw new HveLayoutPlanningError(
          "HVE_LAYER_ASSET_MIME_UNSUPPORTED",
          "Only PNG, JPEG and WebP static brand assets are supported in this renderer release.",
        );
      }
      if (!Number.isInteger(asset.byteSize) || asset.byteSize <= 0 || asset.byteSize > 25 * 1024 * 1024) {
        throw new HveLayoutPlanningError(
          "HVE_LAYER_ASSET_SIZE_INVALID",
          "The selected brand asset is outside the supported size limit.",
        );
      }
      return {
        layerId: layer.id,
        type: staticLayerType,
        outputRange: timeRangeUsSchema.parse({ startUs, endUs }),
        destinationPx: rectToPixels(layer.box, document.export.width, document.export.height),
        opacity: layer.opacity,
        zIndex: layer.zIndex,
        asset,
        fit: "contain" as const,
      };
    }
    // V1 imports used this semantic name. It is resolved here once, not
    // interpreted as a renderer branch. New editor-created titles use the
    // explicit hve-title-v1 identifier.
    if (layer.styleRef !== "hve-title-v1" && layer.styleRef !== "v1-title") {
      throw new HveLayoutPlanningError(
        "HVE_LAYER_STYLE_UNSUPPORTED",
        "The requested title style is not installed on this renderer release.",
      );
    }
    return {
      layerId: layer.id,
      type: "text" as const,
      outputRange: timeRangeUsSchema.parse({ startUs, endUs }),
      destinationPx: rectToPixels(layer.box, document.export.width, document.export.height),
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      text: layer.text,
      style: {
        id: "hve-title-v1" as const,
        // Titles share the same explicit renderer font pack as subtitles.
        // Do not leave libass to resolve a browser-only CSS family.
        fontFamily: rendererFontFamily ?? document.captions.style.fontFamily,
        fontSizePx: Math.min(240, Math.max(48, Math.round(document.captions.style.fontSizePx * 1.18))),
        fontWeight: Math.max(700, document.captions.style.fontWeight),
        color: document.captions.style.color,
        outlineColor: document.captions.style.outlineColor,
        outlinePx: Math.max(3, document.captions.style.outlinePx),
        background: true,
      },
    };
  }).sort((left, right) => left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId));
  const brolls = layers
    .filter((layer): layer is ResolvedBrollLayer => layer.type === "broll")
    .sort((left, right) => left.outputRange.startUs - right.outputRange.startUs || left.layerId.localeCompare(right.layerId));
  for (let index = 1; index < brolls.length; index += 1) {
    if (brolls[index - 1]!.outputRange.endUs > brolls[index]!.outputRange.startUs) {
      throw new HveLayoutPlanningError(
        "HVE_BROLL_RANGES_OVERLAP",
        "B-roll ranges cannot overlap until the transition planner supports crossfades.",
      );
    }
  }
  return { layers: applyCaptionCollisionPolicy(document, captionPlan, layers, warnings), warnings };
}

function warning(
  warnings: EngineWarning[],
  code: string,
  requested: string,
  applied: string,
  userMessage: string,
  range?: Range,
) {
  warnings.push(engineWarningSchema.parse({
    code,
    requested,
    applied,
    userMessage,
    severity: "warning",
    ...(range ? { range } : {}),
  }));
}

function sourcePointToOutput(timeMap: TimeMapEntry[], sourceId: string, sourceUs: number): number | null {
  const entry = timeMap.find((candidate) => candidate.sourceId === sourceId
    && candidate.sourceRange.startUs <= sourceUs
    && sourceUs < candidate.sourceRange.endUs);
  if (!entry) return null;
  const numerator = entry.rate.numerator;
  const denominator = entry.rate.denominator;
  const scaled = (sourceUs - entry.sourceRange.startUs) * denominator;
  if (scaled % numerator !== 0) return null;
  return entry.outputRange.startUs + scaled / numerator;
}

function sourcePointAtOutput(timeMap: TimeMapEntry[], sourceId: string, outputUs: number): number | null {
  const entry = timeMap.find((candidate) => candidate.sourceId === sourceId
    && candidate.outputRange.startUs <= outputUs
    && outputUs < candidate.outputRange.endUs);
  if (!entry) return null;
  const numerator = entry.rate.numerator;
  const denominator = entry.rate.denominator;
  const scaled = (outputUs - entry.outputRange.startUs) * numerator;
  if (scaled % denominator !== 0) return null;
  return entry.sourceRange.startUs + scaled / denominator;
}

function interpolateBox(
  keyframes: HveSceneGraph["regions"][number]["keyframes"],
  sourceUs: number,
) {
  const first = keyframes[0];
  const last = keyframes.at(-1);
  if (!first || !last || sourceUs < first.atUs || sourceUs > last.atUs) return null;
  const rightIndex = keyframes.findIndex((frame) => frame.atUs >= sourceUs);
  const right = keyframes[rightIndex];
  if (!right) return null;
  if (right.atUs === sourceUs || rightIndex === 0) return right;
  const left = keyframes[rightIndex - 1]!;
  const ratio = (sourceUs - left.atUs) / (right.atUs - left.atUs);
  return {
    atUs: sourceUs,
    box: {
      x: left.box.x + (right.box.x - left.box.x) * ratio,
      y: left.box.y + (right.box.y - left.box.y) * ratio,
      width: left.box.width + (right.box.width - left.box.width) * ratio,
      height: left.box.height + (right.box.height - left.box.height) * ratio,
    },
    confidence: Math.min(left.confidence, right.confidence),
  };
}

function portraitCropForFace(
  box: { x: number; y: number; width: number; height: number },
  source: HvePerceptionLayoutContext["source"],
  destination: { width: number; height: number },
) {
  const sourceAspect = source.width / source.height;
  const destinationAspect = destination.width / destination.height;
  const crop = sourceAspect >= destinationAspect
    ? { width: destinationAspect / sourceAspect, height: 1 }
    : { width: 1, height: sourceAspect / destinationAspect };
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  // The face sits in the upper third, which leaves room for readable bottom
  // captions without claiming a semantic "speaker" decision.
  const x = Math.min(Math.max(centerX - crop.width / 2, 0), 1 - crop.width);
  const y = Math.min(Math.max(centerY - crop.height * 0.30, 0), 1 - crop.height);
  return { x, y, width: crop.width, height: crop.height };
}

function resolvePerceptionCropTrack(
  assignment: ClipDocumentV2["layout"][number]["slots"][number],
  outputRange: Range,
  destinationPx: { x: number; y: number; width: number; height: number },
  document: ClipDocumentV2,
  timeMap: TimeMapEntry[],
  context: HvePerceptionLayoutContext | undefined,
  warnings: EngineWarning[],
) {
  if (!assignment.cropTrack || assignment.manualCrop) return null;
  const trackRef = assignment.cropTrack;
  // HVE-3 executes one source. Keep the binding explicit nevertheless: a
  // region's `analysisId` identifies the artifact, never the source itself.
  const sourceRef = document.sourceRefs[0];
  const sourceId = sourceRef?.sourceId;
  if (!sourceId || !context || trackRef.analysisId !== context.analysisId || document.analysisId !== context.analysisId) {
    warning(warnings, "HVE_LAYOUT_TRACK_FALLBACK", trackRef.trackId, "cover", "Траектория кадра не подтверждена текущим анализом. Использован обычный кадр.", outputRange);
    return null;
  }
  const graph = hveSceneGraphSchema.parse(context.graph);
  if (
    graph.sourceId !== sourceId
    || graph.sourceHash !== context.source.sourceHash
    || context.source.sourceId !== sourceId
    || sourceRef.sourceHash !== context.source.sourceHash
    || context.source.width <= 0
    || context.source.height <= 0
    || !sourceRef
  ) {
    warning(warnings, "HVE_LAYOUT_TRACK_SOURCE_MISMATCH", trackRef.trackId, "cover", "Траектория кадра относится к другому исходнику и не применена.", outputRange);
    return null;
  }
  const track = graph.regions.find((candidate) => candidate.id === trackRef.trackId);
  if (!track || !["face", "facecam"].includes(track.kind)) {
    warning(warnings, "HVE_LAYOUT_TRACK_UNAVAILABLE", trackRef.trackId, "cover", "Подтверждённая траектория лица для этого фрагмента недоступна. Использован обычный кадр.", outputRange);
    return null;
  }
  const relevantMap = timeMap.filter((entry) => entry.sourceId === sourceId
    && entry.outputRange.startUs < outputRange.endUs
    && entry.outputRange.endUs > outputRange.startUs);
  if (!relevantMap.length || relevantMap.some((entry) => entry.sourceRange.startUs < track.range.startUs || entry.sourceRange.endUs > track.range.endUs)) {
    warning(warnings, "HVE_LAYOUT_TRACK_COVERAGE_INSUFFICIENT", trackRef.trackId, "cover", "Траектория лица покрывает не весь выбранный фрагмент. Использован обычный кадр.", outputRange);
    return null;
  }
  const sourceAtStart = sourcePointAtOutput(timeMap, sourceId, outputRange.startUs);
  const sourceAtEnd = sourcePointAtOutput(timeMap, sourceId, outputRange.endUs - 1);
  if (sourceAtStart === null || sourceAtEnd === null || !interpolateBox(track.keyframes, sourceAtStart) || !interpolateBox(track.keyframes, sourceAtEnd)) {
    warning(warnings, "HVE_LAYOUT_TRACK_KEYFRAME_INSUFFICIENT", trackRef.trackId, "cover", "Для траектории лица не хватает опорных кадров. Использован обычный кадр.", outputRange);
    return null;
  }
  const outputKeyframes = new Map<number, { atUs: number; crop: ReturnType<typeof portraitCropForFace>; confidence: number }>();
  const addSourcePoint = (sourceUs: number) => {
    const outputUs = sourcePointToOutput(timeMap, sourceId, sourceUs);
    if (outputUs === null || outputUs < outputRange.startUs || outputUs >= outputRange.endUs) return;
    const face = interpolateBox(track.keyframes, sourceUs);
    if (!face) return;
    outputKeyframes.set(outputUs, {
      atUs: outputUs,
      crop: portraitCropForFace(face.box, context.source, destinationPx),
      confidence: Math.min(track.confidence, face.confidence),
    });
  };
  addSourcePoint(sourceAtStart);
  // A source cut creates adjacent output intervals whose source positions are
  // not adjacent. Anchor both sides explicitly so the FFmpeg interpolation
  // never glides a face crop through media that was removed from the clip.
  for (const entry of relevantMap) {
    const localStart = Math.max(entry.outputRange.startUs, outputRange.startUs);
    const localEnd = Math.min(entry.outputRange.endUs, outputRange.endUs) - 1;
    const sourceStart = sourcePointAtOutput(timeMap, sourceId, localStart);
    const sourceEnd = sourcePointAtOutput(timeMap, sourceId, localEnd);
    if (sourceStart !== null) addSourcePoint(sourceStart);
    if (sourceEnd !== null) addSourcePoint(sourceEnd);
  }
  for (const keyframe of track.keyframes) addSourcePoint(keyframe.atUs);
  addSourcePoint(sourceAtEnd);
  const keyframes = [...outputKeyframes.values()].sort((left, right) => left.atUs - right.atUs);
  if (!keyframes.length || keyframes[0]!.atUs !== outputRange.startUs || keyframes.at(-1)!.atUs !== outputRange.endUs - 1) {
    warning(warnings, "HVE_LAYOUT_TRACK_OUTPUT_MAPPING_INSUFFICIENT", trackRef.trackId, "cover", "Траекторию лица нельзя точно перенести после монтажных вырезов. Использован обычный кадр.", outputRange);
    return null;
  }
  return keyframes;
}

function resolveTemplate(templateName: string, slots: ClipDocumentV2["layout"][number]["slots"], warnings: EngineWarning[]) {
  if (templateName in layoutTemplateRegistry) return layoutTemplateRegistry[templateName as LayoutTemplateId];
  warnings.push(engineWarningSchema.parse({
    code: "HVE_LAYOUT_TEMPLATE_FALLBACK",
    requested: templateName,
    applied: "portrait_focus",
    userMessage: "Запрошенный макет недоступен. Применён безопасный одиночный кадр.",
    severity: "warning",
  }));
  if (!slots.some((slot) => slot.slotId === "primary")) {
    throw new HveLayoutPlanningError("HVE_LAYOUT_FALLBACK_SLOT_MISSING", "The fallback layout requires a primary slot.");
  }
  return layoutTemplateRegistry.portrait_focus;
}

/**
 * Resolves anchors, registry geometry and explicit manual crops. Tracking is
 * intentionally not inferred here: HVE-5 will provide crop keyframes as an
 * artifact, then this function will consume them. Until then every default
 * crop is visible, deterministic full-frame geometry.
 */
export function resolveLayoutSegments(
  documentInput: ClipDocumentV2,
  timeMapInput: TimeMapEntry[],
  transcriptWords: TimingTranscriptWord[] = [],
  perceptionContext?: HvePerceptionLayoutContext,
): { segments: ResolvedLayoutSegment[]; warnings: EngineWarning[] } {
  const document = clipDocumentV2Schema.parse(documentInput);
  const timeMap = timeMapSchema.parse(timeMapInput);
  const words = transcriptWords;
  const warnings: EngineWarning[] = [];
  const segments = document.layout.map((segment) => {
    const startUs = resolveAnchor(segment.anchor.start, document, timeMap, words);
    const endUs = resolveAnchor(segment.anchor.end, document, timeMap, words);
    if (startUs < 0 || endUs > clipDurationUs(timeMap) || endUs <= startUs) {
      throw new HveLayoutPlanningError("HVE_LAYOUT_ANCHOR_RANGE_INVALID", "Layout segment resolves outside the output timeline.");
    }
    const template = resolveTemplate(segment.template, segment.slots, warnings);
    const assignmentById = new Map(segment.slots.map((slot) => [slot.slotId, slot]));
    return {
      outputRange: timeRangeUsSchema.parse({ startUs, endUs }),
      slots: template.slots.map((slot) => {
        const assignment = assignmentById.get(slot.id);
        if (!assignment) {
          throw new HveLayoutPlanningError(
            "HVE_LAYOUT_SLOT_MISSING",
            `Layout ${template.id} requires slot ${slot.id}, but no source region was assigned.`,
          );
        }
        const perceptionKeyframes = resolvePerceptionCropTrack(
          assignment,
          { startUs, endUs },
          rectToPixels(slot.destination, document.export.width, document.export.height),
          document,
          timeMap,
          perceptionContext,
          warnings,
        );
        const crop = assignment.manualCrop ?? { x: 0, y: 0, width: 1, height: 1 };
        if (assignment.fit === "smart_cover" && !assignment.manualCrop && !perceptionKeyframes) {
          warnings.push(engineWarningSchema.parse({
            code: "HVE_LAYOUT_SMART_CROP_FALLBACK",
            range: { startUs, endUs },
            requested: "smart_cover",
            applied: "cover",
            userMessage: "Умное кадрирование ещё не рассчитано для этого фрагмента. Использован обычный кадр.",
            severity: "warning",
          }));
        }
        return {
          destinationPx: rectToPixels(slot.destination, document.export.width, document.export.height),
          source: assignment.regionRef,
          fit: assignment.fit,
          cropKeyframes: perceptionKeyframes ?? [{ atUs: startUs, crop }, { atUs: endUs - 1, crop }],
          cornerRadiusPx: Math.round(Math.min(document.export.width, document.export.height) * (slot.cornerRadiusRatio ?? 0)),
          ...(slot.background ? { background: slot.background } : {}),
        };
      }),
    };
  }).sort((left, right) => left.outputRange.startUs - right.outputRange.startUs || left.outputRange.endUs - right.outputRange.endUs);

  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index - 1]!.outputRange.endUs > segments[index]!.outputRange.startUs) {
      throw new HveLayoutPlanningError("HVE_LAYOUT_SEGMENTS_OVERLAP", "Two layout segments overlap on the output timeline.");
    }
  }
  return { segments, warnings };
}
