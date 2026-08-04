import {
  clipDocumentV2Schema,
  clipEdlSchema,
  type ClipDocumentV2,
  type ClipEDL,
} from "../../../../../packages/contracts/src/index.js";

/**
 * Materialize the small legacy EDL adapter the Python worker still consumes.
 *
 * The immutable HVE document and resolved plan are authoritative.  The EDL
 * remains only an execution envelope for the current worker (export codecs,
 * subtitle libass configuration and source metadata).  This adapter prevents
 * a V2 editor save from rendering subtitles with an older V1 style.
 */
function captionModeForPreset(preset: ClipDocumentV2["captions"]["style"]["preset"]): ClipEDL["subtitles"]["mode"] {
  switch (preset) {
    case "karaoke":
      return "karaoke";
    case "active_word":
      return "active_word";
    case "word_pop":
      return "word_by_word";
    case "clean":
    case "bold":
    case "minimal_box":
    case "speaker_colors":
      return "line";
  }
}

export function materializeHveRenderEdl(documentInput: ClipDocumentV2, baseEdlInput: ClipEDL): ClipEDL {
  const document = clipDocumentV2Schema.parse(documentInput);
  const base = clipEdlSchema.parse(baseEdlInput);
  const baseSubtitleConfig = { ...base.subtitles };
  // A stale custom font reference must not survive a V2 style change. If the
  // document explicitly carries a verified font asset it is reintroduced below.
  delete baseSubtitleConfig.fontAssetId;
  const style = document.captions.style;

  return clipEdlSchema.parse({
    ...base,
    // The resolved time map controls source cuts/ranges.  These values must
    // nevertheless reflect document-level renderer choices because the worker
    // still reads them for libass and output encoding.
    subtitles: {
      ...baseSubtitleConfig,
      enabled: document.captions.enabled,
      mode: captionModeForPreset(style.preset),
      preset: style.preset,
      ...(style.fontAssetId ? { fontAssetId: style.fontAssetId } : {}),
      fontFamily: style.fontFamily,
      fontSize: style.fontSizePx,
      fontWeight: style.fontWeight,
      uppercase: style.uppercase,
      maxWordsPerLine: style.maxWordsPerLine,
      maxLines: style.maxLines,
      position: style.position,
      safeMarginPx: style.safeMarginPx,
      color: style.color,
      activeColor: style.activeColor,
      outlineColor: style.outlineColor,
      outlinePx: style.outlinePx,
      background: style.background,
    },
    export: document.export,
    styleVersionId: document.styleVersionId,
    rendererVersion: document.rendererVersion,
  });
}
