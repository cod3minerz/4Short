import {
  captionPlanToAssCues,
  clipDocumentV2Schema,
  hashHve,
  resolveHveFontPlan,
  resolvedRenderPlanSchema,
  type CaptionPlan,
  type ClipDocumentV2,
  type ResolvedRenderPlan,
  type TimingTranscriptWord,
} from "../../../../../packages/contracts/src/index.js";
import {
  resolveLayoutSegments,
  resolveProductionLayers,
  type HvePerceptionLayoutContext,
  type HveStaticAssetResolver,
} from "../../../../../packages/contracts/src/hve-layout.js";
import { planHve2Timing } from "./timing-planner.js";

/**
 * HVE-2 execution adapter.
 *
 * The v1 visual compiler is still responsible for its legacy single-layout
 * geometry. This adapter owns only the parts HVE-2 can execute truthfully:
 * one source, 1x source/output time map, resolved captions and audio timing.
 * More sources, speed changes and production layers must wait for HVE-3's
 * slot compositor rather than being silently dropped by the worker.
 */
export class Hve2PlanNotExecutableError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Hve2PlanNotExecutableError";
  }
}

/** A narrowly scoped compositor path. It has no implicit perception fallback. */
export class Hve3PlanNotExecutableError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Hve3PlanNotExecutableError";
  }
}

export class Hve5PlanNotExecutableError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Hve5PlanNotExecutableError";
  }
}

export interface HveExecutionPayload {
  documentHash: string;
  resolvedPlan: ResolvedRenderPlan;
  subtitleCues: ReturnType<typeof captionPlanToAssCues>;
}

/**
 * Timing-only projection for the browser source reviewer.
 *
 * It deliberately does not resolve crops, assets or production layers: those
 * require verified perception/static-artifact inputs and belong to the final
 * compositor. The output clock, however, is independent of those visual
 * choices and must be identical in the reviewer, captions, audio and worker.
 */
export interface HveEditorSequencePayload {
  documentHash: string;
  timeMap: ResolvedRenderPlan["timeMap"];
  outputDurationUs: number;
  /**
   * A native video element is sufficient for hard cuts. Pause crossfades use
   * two synchronised source elements so the reviewer does not show only one
   * side of the final render's overlap.
   */
  previewMode: "single_media" | "dual_media_crossfade";
}

/**
 * A browser-safe, plan-backed composition preview.
 *
 * This payload contains only resolved geometry, caption/text timing and the
 * requested caption style. It deliberately contains no S3 location, signed
 * URL or mutable asset metadata. The editor may use it to draw the authorised
 * source/proxy onto a Canvas, but it must not claim parity when the document
 * needs perception or a private brand asset.
 */
export interface HveEditorVisualPreviewPayload {
  documentHash: string;
  resolvedPlan: ResolvedRenderPlan;
  captionStyle: ClipDocumentV2["captions"]["style"];
}

/** Kept as a source-compatible name while HVE-2 callers migrate to the shared payload. */
export type Hve2ExecutionPayload = HveExecutionPayload;

function assertHve2Renderable(document: ClipDocumentV2, captions: CaptionPlan, options: { allowProductionLayers?: boolean } = {}) {
  if (document.sourceRefs.length !== 1) {
    throw new Hve2PlanNotExecutableError(
      "HVE2_MULTI_SOURCE_TIMELINE_UNSUPPORTED",
      "HVE-2 can render a single source only. Multi-source compositions require HVE-3.",
    );
  }
  if (document.layers.length && !options.allowProductionLayers) {
    throw new Hve2PlanNotExecutableError(
      "HVE2_PRODUCTION_LAYERS_UNSUPPORTED",
      "HVE-2 cannot render production layers before the slot compositor is available.",
    );
  }
  const expectedSource = document.sourceRefs[0]!.sourceId;
  for (const entry of captions.cues.flatMap((cue) => cue.words)) {
    if (entry.outputRange.endUs <= entry.outputRange.startUs) {
      throw new Hve2PlanNotExecutableError("HVE2_CAPTION_TIMING_INVALID", "Caption timing is not executable.");
    }
  }
  return expectedSource;
}

const hve6TrackedCompositeTemplates = new Set([
  "gameplay_facecam",
  "screen_speaker",
  "picture_in_picture",
  "grid_3",
  "grid_4",
]);

/**
 * HVE-6's first screen/gameplay layouts are intentionally *user verified*.
 * Their screen crop may be manual, but the facecam crop is a moving automated
 * trajectory and therefore needs dense evidence for this exact clip range.
 *
 * A source-wide 0.5 fps graph is useful for a recommendation, but is not a
 * safe foundation for a visible facecam. Refuse instead of quietly rendering
 * a plausible-but-wrong composition.
 */
function assertHve6TrackedCompositeEvidence(
  document: ClipDocumentV2,
  timeMap: ResolvedRenderPlan["timeMap"],
  perceptionContext: HvePerceptionLayoutContext | undefined,
) {
  const usesTrackedComposite = document.layout.some((segment) => (
    hve6TrackedCompositeTemplates.has(segment.template)
    && segment.slots.some((slot) => Boolean(slot.cropTrack) && !slot.manualCrop)
  ));
  if (!usesTrackedComposite) return;

  const evidence = perceptionContext?.faceEvidence;
  if (!evidence || evidence.density !== "dense") {
    throw new Hve5PlanNotExecutableError(
      "HVE6_DENSE_PERCEPTION_REQUIRED",
      "Для композиции с отслеживаемой веб-камерой нужен плотный анализ именно этого клипа.",
    );
  }

  const sourceId = document.sourceRefs[0]?.sourceId;
  const relevantEntries = sourceId
    ? timeMap.filter((entry) => entry.sourceId === sourceId)
    : [];
  const covers = (range: { startUs: number; endUs: number }) => evidence.coverage.some((coverage) => (
    coverage.startUs <= range.startUs && coverage.endUs >= range.endUs
  ));
  if (!relevantEntries.length || relevantEntries.some((entry) => !covers(entry.sourceRange))) {
    throw new Hve5PlanNotExecutableError(
      "HVE6_DENSE_PERCEPTION_COVERAGE_INSUFFICIENT",
      "Плотный анализ не покрывает весь выбранный фрагмент. Обновите анализ перед рендером.",
    );
  }

  // Global sampling coverage proves the worker inspected the whole clip, but
  // it does not prove that *this* user-selected participant stayed visible.
  // HVE-6 composites must never quietly fall back to a centre crop when a
  // facecam/panel track ends mid-clip. A later director can deliberately
  // choose a layout transition; this bounded manual route instead fails
  // before an immutable version is created.
  const trackedSlots = document.layout.flatMap((segment) => (
    hve6TrackedCompositeTemplates.has(segment.template)
      ? segment.slots.filter((slot) => Boolean(slot.cropTrack) && !slot.manualCrop)
      : []
  ));
  for (const slot of trackedSlots) {
    const trackId = slot.cropTrack!.trackId;
    const track = perceptionContext?.graph.regions.find((candidate) => (
      candidate.id === trackId && candidate.kind === "face"
    ));
    const keyframes = track?.keyframes ?? [];
    const firstKeyframe = keyframes[0];
    const lastKeyframe = keyframes.at(-1);
    const supportsEveryRetainedRange = Boolean(
      track
      && firstKeyframe
      && lastKeyframe
      && relevantEntries.every((entry) => (
        track.range.startUs <= entry.sourceRange.startUs
        && track.range.endUs >= entry.sourceRange.endUs
        && firstKeyframe.atUs <= entry.sourceRange.startUs
        && lastKeyframe.atUs >= entry.sourceRange.endUs - 1
      )),
    );
    if (!supportsEveryRetainedRange) {
      throw new Hve5PlanNotExecutableError(
        "HVE6_FACE_TRACK_COVERAGE_INSUFFICIENT",
        "Выбранный трек лица не покрывает весь клип. Выберите другого участника или другой макет.",
      );
    }
  }
}

async function resolveBaseExecutionPlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
  options: { allowProductionLayers?: boolean } = {},
): Promise<Hve2ExecutionPayload> {
  const document = clipDocumentV2Schema.parse(documentInput);
  const fontPlan = resolveHveFontPlan(document.captions.style);
  const timing = planHve2Timing(document, transcriptWords);
  const expectedSource = assertHve2Renderable(document, timing.captions, options);
  for (const entry of timing.timeMap) {
    if (entry.sourceId !== expectedSource) {
      throw new Hve2PlanNotExecutableError(
        "HVE2_MULTI_SOURCE_TIMELINE_UNSUPPORTED",
        "HVE-2 time map contains a source other than the document source.",
      );
    }
    if (entry.rate.numerator !== 1 || entry.rate.denominator !== 1) {
      throw new Hve2PlanNotExecutableError(
        "HVE2_RATE_CHANGE_UNSUPPORTED",
        "HVE-2 time-map rendering supports 1x speed only.",
      );
    }
  }

  const documentHash = await hashHve(document);
  const resolvedPlan = resolvedRenderPlanSchema.parse({
    schemaVersion: 1,
    documentHash,
    canvas: { width: document.export.width, height: document.export.height, fps: document.export.fps },
    timeMap: timing.timeMap,
    layoutSegments: [],
    captionPlan: timing.captions,
    fontPlan,
    layerPlan: [],
    audioPlan: timing.audio,
    warnings: timing.captions.warnings,
    dependencies: [],
  });
  return { documentHash, resolvedPlan, subtitleCues: captionPlanToAssCues(timing.captions) };
}

/**
 * Resolves only the canonical HVE output clock for source review. This is not
 * a renderability check, so a document with a banner or a tracked crop may
 * still receive an honest sequence clock while the UI continues to label its
 * media as source review rather than a final visual preview.
 */
export async function resolveHveEditorSequencePlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
): Promise<HveEditorSequencePayload> {
  const document = clipDocumentV2Schema.parse(documentInput);
  const timing = planHve2Timing(document, transcriptWords);
  const last = timing.timeMap.at(-1);
  if (!last) throw new Hve2PlanNotExecutableError("HVE_SEQUENCE_EMPTY", "HVE sequence has no retained media.");
  return {
    documentHash: await hashHve(document),
    timeMap: timing.timeMap,
    outputDurationUs: last.outputRange.endUs,
    previewMode: timing.timeMap.some((entry) => (entry.transitionInUs ?? 0) > 0)
      ? "dual_media_crossfade"
      : "single_media",
  };
}

/**
 * Resolve the exact HVE-3 geometry available to the browser composition
 * canvas. This is intentionally narrower than final renderability:
 *
 * - no tracked crop: tracking needs a verified perception artifact;
 * - no image/video/banner layers: the browser does not receive private media
 *   locators from a resolved plan;
 * - no blur background: Canvas source review must not approximate the worker
 *   blur recipe as though it were an identical result.
 *
 * Text layers are included because their text/geometry are already immutable
 * plan data. Final glyph shaping remains an FFmpeg/libass verification step.
 */
export async function resolveHveEditorVisualPreviewPlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
): Promise<HveEditorVisualPreviewPayload> {
  const document = clipDocumentV2Schema.parse(documentInput);
  if (document.layout.some((segment) => segment.slots.some((slot) => Boolean(slot.cropTrack) && !slot.manualCrop))) {
    throw new Hve3PlanNotExecutableError(
      "HVE_EDITOR_PREVIEW_PERCEPTION_REQUIRED",
      "The browser composition preview requires verified perception for a tracked crop.",
    );
  }
  if (document.layers.some((layer) => layer.type !== "text")) {
    throw new Hve3PlanNotExecutableError(
      "HVE_EDITOR_PREVIEW_PRIVATE_ASSET_REQUIRED",
      "The browser composition preview cannot expose a private production asset.",
    );
  }

  const execution = await resolveHve3ExecutionPlan(document, transcriptWords);
  if (execution.resolvedPlan.layoutSegments.some((segment) => segment.slots.some((slot) => slot.background === "blur"))) {
    throw new Hve3PlanNotExecutableError(
      "HVE_EDITOR_PREVIEW_BLUR_UNSUPPORTED",
      "The browser composition preview does not approximate a worker blur layout.",
    );
  }
  return {
    documentHash: execution.documentHash,
    resolvedPlan: execution.resolvedPlan,
    captionStyle: document.captions.style,
  };
}

/**
 * Builds the immutable payload passed to `render_clip`. The worker validates
 * the time map again as a defence-in-depth boundary. This function may run in
 * the control API because it works only with immutable document/transcript
 * input and performs no media or model operation.
 */
export async function resolveHve2ExecutionPlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
): Promise<Hve2ExecutionPayload> {
  return resolveBaseExecutionPlan(documentInput, transcriptWords);
}

/**
 * HVE-3's first compositor execution input. This is deliberately restricted
 * to contiguous, hard-cut source-slot layout segments made from source
 * regions. Face, screen and gameplay roles need analysis artifacts
 * (HVE-5/HVE-6). The compositor can change a geometry only at an explicit
 * output-clock segment boundary; crossfades remain unsupported because they
 * would need to shift every dependent caption and production-layer clock.
 */
async function resolveCompositorExecutionPlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
  perceptionContext?: HvePerceptionLayoutContext,
  assetResolver?: HveStaticAssetResolver,
): Promise<Hve2ExecutionPayload> {
  const document = clipDocumentV2Schema.parse(documentInput);
  const hve2 = await resolveBaseExecutionPlan(document, transcriptWords, { allowProductionLayers: true });
  assertHve6TrackedCompositeEvidence(document, hve2.resolvedPlan.timeMap, perceptionContext);
  const layout = resolveLayoutSegments(document, hve2.resolvedPlan.timeMap, transcriptWords, perceptionContext);
  const crossfades = hve2.resolvedPlan.timeMap.flatMap((entry, index) => {
    const durationUs = entry.transitionInUs ?? 0;
    const previous = index > 0 ? hve2.resolvedPlan.timeMap[index - 1] : undefined;
    return durationUs > 0 && previous
      ? [{ startUs: entry.outputRange.startUs, endUs: previous.outputRange.endUs }]
      : [];
  });
  if (crossfades.length) {
    if (document.layout.some((segment) => segment.slots.some((slot) => Boolean(slot.cropTrack)))) {
      throw new Hve3PlanNotExecutableError(
        "HVE3_CROSSFADE_TRACKED_CROP_UNSUPPORTED",
        "Crossfade with a moving crop is not available until the compositor can blend two independently tracked source frames.",
      );
    }
    for (const crossfade of crossfades) {
      const owningSegments = layout.segments.filter((segment) => (
        segment.outputRange.startUs <= crossfade.startUs
        && segment.outputRange.endUs >= crossfade.endUs
      ));
      if (owningSegments.length !== 1) {
        throw new Hve3PlanNotExecutableError(
          "HVE3_CROSSFADE_LAYOUT_BOUNDARY_UNSUPPORTED",
          "A crossfade cannot cross a layout boundary until two compositor states can blend together.",
        );
      }
    }
  }
  let productionLayers;
  try {
    productionLayers = resolveProductionLayers(
      document,
      hve2.resolvedPlan.timeMap,
      transcriptWords,
      assetResolver,
      hve2.resolvedPlan.fontPlan.rendererFamily,
      hve2.resolvedPlan.captionPlan,
    );
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      throw new Hve3PlanNotExecutableError(String((error as { code: unknown }).code), error.message);
    }
    throw error;
  }
  const expectedDurationUs = hve2.resolvedPlan.timeMap.at(-1)!.outputRange.endUs;
  if (layout.segments[0]?.outputRange.startUs !== 0
    || layout.segments.at(-1)?.outputRange.endUs !== expectedDurationUs
    || layout.segments.some((segment, index) => index > 0 && layout.segments[index - 1]!.outputRange.endUs !== segment.outputRange.startUs)) {
    throw new Hve3PlanNotExecutableError(
      "HVE3_LAYOUT_TIMELINE_UNSUPPORTED",
      "The HVE-3 compositor requires contiguous hard-cut layout segments that cover the whole clip.",
    );
  }
  if (layout.segments.some((segment) => segment.slots.some((slot) => slot.source.kind !== "source"))) {
    throw new Hve3PlanNotExecutableError(
      "HVE3_REGION_ARTIFACT_REQUIRED",
      "Face, screen and gameplay slots require a verified analysis artifact before rendering.",
    );
  }
  return {
    ...hve2,
    resolvedPlan: resolvedRenderPlanSchema.parse({
      ...hve2.resolvedPlan,
      layoutSegments: layout.segments,
      layerPlan: productionLayers.layers,
      warnings: [...hve2.resolvedPlan.warnings, ...layout.warnings, ...productionLayers.warnings],
    }),
  };
}

/**
 * HVE-3 has no perception input: source slots may use manual or full-frame
 * crops only. A cropTrack in the document consequently stays a visible
 * planner fallback instead of becoming an unverified tracking claim.
 */
export async function resolveHve3ExecutionPlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
  assetResolver?: HveStaticAssetResolver,
): Promise<Hve2ExecutionPayload> {
  return resolveCompositorExecutionPlan(documentInput, transcriptWords, undefined, assetResolver);
}

/**
 * HVE-5 consumes a single immutable source scene graph selected by the caller
 * after release/source/hash verification. It may create an output-clock crop
 * trajectory only for an explicit document cropTrack. It does not select an
 * active speaker, alter a user-locked layout, or make the artifact public.
 */
export async function resolveHve5ExecutionPlan(
  documentInput: ClipDocumentV2,
  transcriptWords: TimingTranscriptWord[],
  perceptionContext: HvePerceptionLayoutContext,
  assetResolver?: HveStaticAssetResolver,
): Promise<Hve2ExecutionPayload> {
  const document = clipDocumentV2Schema.parse(documentInput);
  if (document.analysisId !== perceptionContext.analysisId) {
    throw new Hve5PlanNotExecutableError(
      "HVE5_ANALYSIS_ID_MISMATCH",
      "The requested HVE-5 artifact does not match the document analysis version.",
    );
  }
  return resolveCompositorExecutionPlan(document, transcriptWords, perceptionContext, assetResolver);
}
