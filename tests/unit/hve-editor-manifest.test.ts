import assert from "node:assert/strict";
import test from "node:test";
import { selectEditorPreview } from "../../services/control-api/src/services/hve/editor-manifest.js";

const original = { id: "original", mimeType: "video/mp4", usable: true };
const proxy = { id: "proxy", mimeType: "video/mp4", usable: true };

test("editor manifest prefers a retained browser proxy over the original", () => {
  assert.deepEqual(selectEditorPreview({
    proxy,
    original,
    probe: { browserCompatible: true, video: { codec_name: "h264" }, audio: { codec_name: "aac" } },
  }), { status: "ready", mediaId: "proxy", source: "proxy" });
});

test("editor manifest exposes an original only after the probe proves H.264/AAC", () => {
  assert.deepEqual(selectEditorPreview({
    proxy: null,
    original,
    probe: { video: { codec_name: "h264" }, audio: { codec_name: "aac" } },
  }), { status: "ready", mediaId: "original", source: "original" });

  assert.deepEqual(selectEditorPreview({
    proxy: null,
    original,
    probe: { video: { codec_name: "hevc" }, audio: { codec_name: "aac" } },
  }), { status: "pending_proxy", reason: "browser_proxy_pending" });
});

test("editor manifest never treats a MIME label or an expired object as playback evidence", () => {
  assert.deepEqual(selectEditorPreview({
    proxy: null,
    original: { id: "unverified", mimeType: "video/mp4", usable: true },
    probe: null,
  }), { status: "pending_proxy", reason: "browser_proxy_pending" });
  assert.deepEqual(selectEditorPreview({
    proxy: { ...proxy, usable: false },
    original: { ...original, usable: false },
    probe: { browserCompatible: true },
  }), { status: "pending_proxy", reason: "source_media_unavailable" });
});
