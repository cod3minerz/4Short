/**
 * HVE editor playback is deliberately conservative. The source object is
 * useful for transcript review and source-time seeking, but is not a preview
 * of the final composition: final output is always driven by a resolved plan.
 *
 * This pure selector lets the route make that distinction without ever
 * exposing an S3 object key to the browser.
 */
export type EditorPreviewMedia = {
  id: string;
  mimeType: string;
  usable: boolean;
};

export type EditorProbe = {
  browserCompatible?: unknown;
  video?: { codec_name?: unknown } | null;
  audio?: { codec_name?: unknown } | null;
} | null | undefined;

export type EditorPreviewSelection =
  | { status: "ready"; mediaId: string; source: "proxy" | "original" }
  | {
      status: "pending_proxy";
      /** `browser_media_contract_unavailable` is added by the signed-url
       * boundary after this selector chooses a retained media object. */
      reason: "browser_proxy_pending" | "source_media_unavailable" | "browser_media_contract_unavailable";
    };

function isVerifiedBrowserOriginal(probe: EditorProbe, media: EditorPreviewMedia) {
  if (!media.usable || media.mimeType !== "video/mp4") return false;
  if (probe?.browserCompatible === true) return true;
  return probe?.video?.codec_name === "h264" && probe.audio?.codec_name === "aac";
}

/**
 * Prefer the bounded, verified proxy. The original is allowed only when the
 * source probe proved H.264/AAC browser compatibility; filename extension and
 * S3 Content-Type alone are never enough evidence.
 */
export function selectEditorPreview(input: {
  proxy: EditorPreviewMedia | null;
  original: EditorPreviewMedia | null;
  probe: EditorProbe;
}): EditorPreviewSelection {
  if (input.proxy?.usable && input.proxy.mimeType === "video/mp4") {
    return { status: "ready", mediaId: input.proxy.id, source: "proxy" };
  }
  if (input.original && isVerifiedBrowserOriginal(input.probe, input.original)) {
    return { status: "ready", mediaId: input.original.id, source: "original" };
  }
  return {
    status: "pending_proxy",
    reason: input.original?.usable ? "browser_proxy_pending" : "source_media_unavailable",
  };
}
