import { createHash } from "node:crypto";
import {
  clipDocumentV2Schema,
  clipEdlSchema,
  resolveHveFontPlan,
  type ClipDocumentV2,
  type ClipEDL,
  type TimingTranscriptWord,
} from "../../../../../packages/contracts/src/index.js";

/**
 * Converts the *executable* subset of a legacy initial EDL into HVE's
 * canonical document. This is deliberately not a best-effort conversion:
 * layouts requiring face/screen evidence or unresolved brand assets stay on
 * the v1 path until their HVE planner inputs exist.
 *
 * Keeping this decision at the creation boundary prevents the editor from
 * advertising a server draft for a clip whose first version cannot be
 * reproduced by the HVE renderer.
 */
export type InitialHveDocumentResult =
  | { supported: true; document: ClipDocumentV2 }
  | { supported: false; reason: string };

function stableUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function layoutTemplateFor(edl: ClipEDL): "portrait_focus" | "blur_background" | null {
  switch (edl.layout.mode) {
    case "auto":
    case "static_crop":
      return "portrait_focus";
    case "blur_background":
      return "blur_background";
    // These modes require verified face/screen/region artifacts. Mapping one
    // of them to a centre crop would make the first immutable HVE version lie.
    case "active_speaker":
    case "two_speakers":
    case "video_image":
    case "picture_in_picture":
    case "screen_gameplay":
      return null;
  }
}

function initialLayerSupport(edl: ClipEDL) {
  // Text is compiled to an explicit HVE-3 layer. Assets need a workspace
  // asset resolver and immutable media hashes, neither of which is available
  // to the legacy face_track completion payload.
  if (edl.logo?.assetId || edl.banner?.assetId) return false;
  return true;
}

/**
 * Build the first HVE document for a newly accepted clip. It only emits a
 * document when every persisted edit can be executed by HVE-3 today.
 */
export function buildInitialHveDocument(input: {
  clipId: string;
  edl: ClipEDL;
  transcriptWords: TimingTranscriptWord[];
  /** Snapshot of append-only transcript edits captured into this version. */
  captionOverrides?: Array<{
    wordId: string;
    displayText?: string;
    hidden: boolean;
    cutFromMedia: boolean;
  }>;
  plannerVersion: string;
  rendererVersion: string;
}): InitialHveDocumentResult {
  const edl = clipEdlSchema.parse(input.edl);
  const template = layoutTemplateFor(edl);
  if (!template) return { supported: false, reason: "HVE_INITIAL_LAYOUT_EVIDENCE_REQUIRED" };
  if (!initialLayerSupport(edl)) return { supported: false, reason: "HVE_INITIAL_ASSET_RESOLVER_REQUIRED" };
  try {
    // Do this before emitting a document: an existing v1 style may still
    // reference a font which its legacy renderer can use, while HVE cannot
    // reproduce it deterministically yet. Such a project must retain v1,
    // not fail halfway through face_track completion.
    resolveHveFontPlan(edl.subtitles);
  } catch {
    return { supported: false, reason: "HVE_INITIAL_FONT_UNSUPPORTED" };
  }

  const startUs = edl.range.startMs * 1_000;
  const endUs = edl.range.endMs * 1_000;
  const analysisId = stableUuid(`hve-source-only-analysis:v1:${edl.sourceId}:${edl.sourceHash}`);
  const narrativeId = stableUuid(`hve-narrative:v1:${input.clipId}:${startUs}:${endUs}`);
  const layoutId = stableUuid(`hve-layout:v1:${input.clipId}:${template}`);
  const wordsInRange = input.transcriptWords.filter((word) => word.sourceId === edl.sourceId
    && word.sourceRange.startUs >= startUs
    && word.sourceRange.endUs <= endUs);
  const captionOverrideByWord = new Map((input.captionOverrides ?? []).map((override) => [override.wordId, override]));
  // A clip-specific v1 EDL edit is narrower than a project transcript
  // revision. Preserve both: it can refine display text for this clip, but it
  // can never resurrect a word the project already removed from media.
  const legacyEditByWord = new Map(edl.transcriptEdits.map((edit) => [edit.wordRef, edit]));
  const title = edl.title?.text?.trim();

  return {
    supported: true,
    document: clipDocumentV2Schema.parse({
      schemaVersion: 2,
      clipId: input.clipId,
      sourceRefs: [{ sourceId: edl.sourceId, sourceHash: edl.sourceHash }],
      timebase: { ticksPerSecond: 1_000_000, frameRate: { numerator: edl.export.fps, denominator: 1 } },
      narrative: [{
        id: narrativeId,
        sourceId: edl.sourceId,
        sourceRange: { startUs, endUs },
        enabled: true,
        order: 0,
        transcriptWordIds: wordsInRange.map((word) => word.wordId),
        transitionIn: "cut",
        transitionOut: "cut",
      }],
      layout: [{
        id: layoutId,
        anchor: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
        template,
        slots: [{
          slotId: "primary",
          regionRef: { analysisId, trackId: "source", kind: "source" },
          fit: template === "blur_background" ? "contain" : "cover",
        }],
        provenance: { origin: "style", reasonCode: "INITIAL_STYLE_IMPORT" },
        lockedByUser: false,
      }],
      captions: {
        enabled: edl.subtitles.enabled,
        language: "ru",
        words: wordsInRange.map((word) => {
          const revisionOverride = captionOverrideByWord.get(word.wordId);
          const clipOverride = legacyEditByWord.get(word.wordId);
          return {
            wordId: word.wordId,
            ...(typeof (clipOverride?.displayText ?? revisionOverride?.displayText) === "string"
              ? { displayText: clipOverride?.displayText ?? revisionOverride?.displayText }
              : {}),
            hidden: Boolean(revisionOverride?.hidden || clipOverride?.hiddenFromSubtitles),
            cutFromMedia: Boolean(revisionOverride?.cutFromMedia || clipOverride?.cutFromMedia),
          };
        }),
        style: {
          preset: edl.subtitles.preset === "pulse" ? "word_pop" : edl.subtitles.preset,
          ...(edl.subtitles.fontAssetId ? { fontAssetId: edl.subtitles.fontAssetId } : {}),
          fontFamily: edl.subtitles.fontFamily,
          fontSizePx: edl.subtitles.fontSize,
          fontWeight: edl.subtitles.fontWeight,
          uppercase: edl.subtitles.uppercase,
          maxWordsPerLine: edl.subtitles.maxWordsPerLine,
          maxLines: edl.subtitles.maxLines,
          position: edl.subtitles.position,
          safeMarginPx: edl.subtitles.safeMarginPx,
          color: edl.subtitles.color,
          activeColor: edl.subtitles.activeColor,
          outlineColor: edl.subtitles.outlineColor,
          outlinePx: edl.subtitles.outlinePx,
          background: edl.subtitles.background,
        },
      },
      layers: title ? [{
        id: stableUuid(`hve-title:v1:${input.clipId}:${title}`),
        type: "text",
        anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
        followPolicy: "follow_narrative",
        zIndex: 10,
        anchor: edl.title?.anchor ?? "top_center",
        box: { x: 0.05, y: 0.05, width: Math.min((edl.title?.widthPercent ?? 90) / 100, 0.9), height: 0.18 },
        opacity: edl.title?.opacity ?? 1,
        collisionPolicy: "warn",
        text: title,
        styleRef: "hve-title-v1",
      }] : [],
      audio: {
        sourceCuts: edl.cuts.map((cut) => ({
          sourceId: edl.sourceId,
          sourceRange: { startUs: cut.startMs * 1_000, endUs: cut.endMs * 1_000 },
          reason: "user",
        })),
        pauseRemoval: {
          enabled: edl.silence.enabled,
          minimumUs: edl.silence.minimumMs * 1_000,
          beforePaddingUs: edl.silence.beforePaddingMs * 1_000,
          afterPaddingUs: edl.silence.afterPaddingMs * 1_000,
          crossfadeUs: edl.silence.crossfadeMs * 1_000,
        },
        loudness: { targetLufs: -16, truePeakDb: -1.5 },
      },
      export: edl.export,
      styleVersionId: edl.styleVersionId,
      analysisId,
      plannerVersion: input.plannerVersion,
      rendererVersion: input.rendererVersion,
    }),
  };
}
