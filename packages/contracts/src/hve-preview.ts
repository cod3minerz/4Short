import {
  resolvedRenderPlanSchema,
  type ResolvedRenderPlan,
  type TimeMapEntry,
} from "./hve-v2.js";

/**
 * Browser/editor-facing projection of the exact immutable render plan.
 *
 * This is deliberately geometry and timing only: it neither reads media nor
 * runs perception. A native `SequencePlayer` can use each source time to seek
 * its proxy, while Canvas/WebGL applies the returned crop/slot geometry. By
 * keeping this derivation in contracts, preview cannot invent a different
 * crop clock from the worker's resolved plan.
 */
export type HvePreviewSlot = {
  slotIndex: number;
  sourceId: string;
  sourceTimeUs: number;
  destinationPx: { x: number; y: number; width: number; height: number };
  sourceCrop: { x: number; y: number; width: number; height: number };
  fit: "cover" | "contain" | "smart_cover";
  cornerRadiusPx: number;
  background?: "transparent" | "blur" | "solid";
};

/**
 * A media-free projection of a resolved production layer.  The browser gets
 * timing, geometry and the immutable asset identity from the same plan that
 * FFmpeg executes; obtaining a signed proxy URL remains an application-layer
 * concern and must not be embedded in the render plan.
 */
export type HvePreviewLayer =
  | {
    layerId: string;
    type: "text";
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
  }
  | {
    layerId: string;
    type: "image" | "logo" | "banner";
    destinationPx: { x: number; y: number; width: number; height: number };
    opacity: number;
    zIndex: number;
    assetId: string;
    fit: "contain";
  }
  | {
    layerId: string;
    type: "video";
    destinationPx: { x: number; y: number; width: number; height: number };
    opacity: number;
    zIndex: number;
    assetId: string;
    fit: "contain";
    /** Timed visual media is previewed muted until timed-audio exists. */
    muted: true;
    loop?: boolean;
  }
  | {
    layerId: string;
    type: "broll";
    destinationPx: { x: number; y: number; width: number; height: number };
    opacity: 1;
    zIndex: number;
    assetId: string;
    fit: "cover";
    muted: true;
    visualPolicy: "replace_full_canvas_keep_narrative_audio";
  };

export type HvePreviewFrame = {
  outputTimeUs: number;
  canvas: ResolvedRenderPlan["canvas"];
  slots: HvePreviewSlot[];
  captions: ResolvedRenderPlan["captionPlan"]["cues"];
  /** Active production layers, ordered exactly as the compositor sees them. */
  layers: HvePreviewLayer[];
};

function sourceTimeAtOutput(
  timeMap: TimeMapEntry[],
  sourceId: string,
  outputUs: number,
  entryIndex?: number,
): number | null {
  const entry = entryIndex === undefined
    ? timeMap.find((candidate) => candidate.sourceId === sourceId
      && candidate.outputRange.startUs <= outputUs
      && outputUs < candidate.outputRange.endUs)
    : timeMap[entryIndex];
  if (!entry
    || entry.sourceId !== sourceId
    || entry.outputRange.startUs > outputUs
    || entry.outputRange.endUs <= outputUs) return null;
  const outputOffset = outputUs - entry.outputRange.startUs;
  // Source microseconds may be fractional after a future rational-rate map.
  // Keep the scalar precise for the player rather than rounding to another
  // frame/tick; the current executable HVE subset is strictly 1×.
  return entry.sourceRange.startUs + outputOffset * entry.rate.numerator / entry.rate.denominator;
}

function interpolateCrop(
  keyframes: ResolvedRenderPlan["layoutSegments"][number]["slots"][number]["cropKeyframes"],
  outputUs: number,
) {
  const first = keyframes[0];
  const last = keyframes.at(-1);
  if (!first || !last || outputUs < first.atUs || outputUs > last.atUs) {
    throw new Error("HVE_PREVIEW_CROP_COVERAGE_INVALID");
  }
  const rightIndex = keyframes.findIndex((keyframe) => keyframe.atUs >= outputUs);
  const right = keyframes[rightIndex];
  if (!right) throw new Error("HVE_PREVIEW_CROP_COVERAGE_INVALID");
  if (right.atUs === outputUs || rightIndex === 0) return right.crop;
  const left = keyframes[rightIndex - 1]!;
  const fraction = (outputUs - left.atUs) / (right.atUs - left.atUs);
  return {
    x: left.crop.x + (right.crop.x - left.crop.x) * fraction,
    y: left.crop.y + (right.crop.y - left.crop.y) * fraction,
    width: left.crop.width + (right.crop.width - left.crop.width) * fraction,
    height: left.crop.height + (right.crop.height - left.crop.height) * fraction,
  };
}

function activePreviewLayers(plan: ResolvedRenderPlan, outputUs: number): HvePreviewLayer[] {
  return plan.layerPlan
    .filter((layer) => layer.outputRange.startUs <= outputUs && outputUs < layer.outputRange.endUs)
    .map((layer): HvePreviewLayer => {
      if (layer.type === "text") {
        return {
          layerId: layer.layerId,
          type: layer.type,
          destinationPx: layer.destinationPx,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          text: layer.text,
          style: layer.style,
        };
      }
      if (layer.type === "broll") {
        return {
          layerId: layer.layerId,
          type: layer.type,
          destinationPx: layer.destinationPx,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          assetId: layer.asset.assetId,
          fit: layer.fit,
          muted: layer.muted,
          visualPolicy: layer.visualPolicy,
        };
      }
      if (layer.type === "video") {
        return {
          layerId: layer.layerId,
          type: layer.type,
          destinationPx: layer.destinationPx,
          opacity: layer.opacity,
          zIndex: layer.zIndex,
          assetId: layer.asset.assetId,
          fit: layer.fit,
          muted: true,
          loop: layer.loop,
        };
      }
      return {
        layerId: layer.layerId,
        type: layer.type,
        destinationPx: layer.destinationPx,
        opacity: layer.opacity,
        zIndex: layer.zIndex,
        assetId: layer.asset.assetId,
        fit: layer.fit,
      };
    })
    .sort((left, right) => left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId));
}

/**
 * Resolves one output instant. `null` is an honest end-of-sequence/empty
 * layout response; malformed geometry is an error, not a centre-crop guess.
 */
export function resolveHvePreviewFrame(
  planInput: ResolvedRenderPlan,
  outputUs: number,
  options: { timeMapEntryIndex?: number } = {},
): HvePreviewFrame | null {
  const plan = resolvedRenderPlanSchema.parse(planInput);
  if (!Number.isSafeInteger(outputUs) || outputUs < 0) throw new Error("HVE_PREVIEW_TIME_INVALID");
  const durationUs = plan.timeMap.at(-1)?.outputRange.endUs ?? 0;
  if (outputUs >= durationUs) return null;
  const layout = plan.layoutSegments.find((segment) => segment.outputRange.startUs <= outputUs && outputUs < segment.outputRange.endUs);
  if (!layout) return null;
  const sourceIds = [...new Set(plan.timeMap.map((entry) => entry.sourceId))];
  // Resolved HVE-3 slots currently refer to their logical slot/track ID, not
  // an independently playable media source. It is executable only for one
  // source; do not make up a mapping when multi-source composition arrives.
  if (sourceIds.length !== 1) throw new Error("HVE_PREVIEW_MULTI_SOURCE_UNSUPPORTED");
  const sourceId = sourceIds[0]!;
  const slots = layout.slots.map((slot, slotIndex) => {
    const sourceTimeUs = sourceTimeAtOutput(plan.timeMap, sourceId, outputUs, options.timeMapEntryIndex);
    // The planner/renderer already reject non-source regions for this HVE-3
    // subset; keep the preview equally strict.
    if (slot.source.kind !== "source" || sourceTimeUs === null) {
      throw new Error("HVE_PREVIEW_SOURCE_MAPPING_UNAVAILABLE");
    }
    return {
      slotIndex,
      sourceId,
      sourceTimeUs,
      destinationPx: slot.destinationPx,
      sourceCrop: interpolateCrop(slot.cropKeyframes, outputUs),
      fit: slot.fit,
      cornerRadiusPx: slot.cornerRadiusPx,
      ...(slot.background ? { background: slot.background } : {}),
    };
  });
  return {
    outputTimeUs: outputUs,
    canvas: plan.canvas,
    slots,
    captions: plan.captionPlan.cues.filter((cue) => cue.outputRange.startUs <= outputUs && outputUs < cue.outputRange.endUs),
    layers: activePreviewLayers(plan, outputUs),
  };
}
