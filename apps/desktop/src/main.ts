import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>("v");
const canvas = $<HTMLCanvasElement>("c");
const logEl = $<HTMLPreElement>("log");
let picked: string | null = null;

function log(line: string) {
  logEl.textContent += `${new Date().toISOString().slice(11, 23)}  ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// The overlay canvas is the same technique HveCompositionPreview uses: the
// <video> element is the clock and a canvas is drawn on top each frame.
function drawOverlay() {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    canvas.width = video.clientWidth || 640;
    canvas.height = video.clientHeight || 360;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,200,0,0.9)";
    ctx.font = "20px sans-serif";
    ctx.fillText(`t=${video.currentTime.toFixed(3)}s`, 12, 28);
  }
  requestAnimationFrame(drawOverlay);
}
requestAnimationFrame(drawOverlay);

$("sys").onclick = async () => {
  const info = await invoke("sys_info");
  log(`sys: ${JSON.stringify(info)}`);
  log(`ua: ${navigator.userAgent}`);
  for (const t of [
    'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    'video/mp4; codecs="hvc1.1.6.L93.B0"',
    'video/webm; codecs="vp9, opus"',
    'video/x-matroska',
  ]) log(`canPlayType ${t} -> ${video.canPlayType(t) || "no"}`);
};

$("pick").onclick = async () => {
  const f = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }] });
  if (!f || Array.isArray(f)) return;
  picked = f;
  const url = convertFileSrc(f);
  log(`picked ${f}`);
  log(`asset url ${url}`);
  video.onerror = () => log(`video error code=${video.error?.code} msg=${video.error?.message}`);
  video.onloadedmetadata = () =>
    log(`metadata ok: ${video.videoWidth}x${video.videoHeight}, duration=${video.duration.toFixed(2)}s`);
  video.src = url;
  video.load();
};

$("seek").onclick = async () => {
  if (!video.duration) return log("pick a video first");
  const points = [0.1, 0.5, 0.9, 0.3, 0.7].map((p) => p * video.duration);
  for (const t of points) {
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = t;
    });
    log(`seek to ${t.toFixed(1)}s took ${(performance.now() - t0).toFixed(0)} ms`);
  }
};

$("ff").onclick = async () => {
  try {
    const r = await invoke("run_tool", { program: "ffmpeg", args: ["-version"] });
    log(`ffmpeg: ${JSON.stringify(r)}`);
  } catch (e) {
    log(`ffmpeg failed: ${e}`);
  }
};

$("probe").onclick = async () => {
  if (!picked) return log("pick a video first");
  try {
    const r = await invoke("run_tool", {
      program: "ffprobe",
      args: ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height", "-of", "json", picked],
    });
    log(`ffprobe: ${JSON.stringify(r)}`);
  } catch (e) {
    log(`ffprobe failed: ${e}`);
  }
};
