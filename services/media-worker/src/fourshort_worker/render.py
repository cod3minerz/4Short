from __future__ import annotations

from pathlib import Path

from .config import Settings
from .process import run_command


def compile_video_filter(edl: dict, ass_path: Path | None) -> str:
    export = edl["export"]
    width, height = int(export["width"]), int(export["height"])
    layout = edl["layout"]
    mode = layout["mode"]
    if mode == "blur_background":
        chain = (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=24:12[blur];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[front];"
            f"[blur][front]overlay=(W-w)/2:(H-h)/2[v]"
        )
    elif mode == "static_crop":
        # x/y are normalized (0-1) positions of the crop window along the
        # slack left over after the fill-scale, not raw pixel offsets — 0.5
        # each reproduces the plain centre-crop the old unconditional branch
        # always did, and this is the first place the "else" branch's silent
        # x/y/zoom == "static_crop's own documented, contract-accepted
        # params (packages/contracts/src/media.ts) were previously ignored.
        zoom = max(float(layout.get("zoom", 1)), 1.0)
        x_norm = min(max(float(layout.get("x", 0.5)), 0.0), 1.0)
        y_norm = min(max(float(layout.get("y", 0.5)), 0.0), 1.0)
        scale_w, scale_h = round(width * zoom), round(height * zoom)
        chain = (
            f"[0:v]scale={scale_w}:{scale_h}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:'(iw-{width})*{x_norm}':'(ih-{height})*{y_norm}'[v]"
        )
    else:
        # auto and every not-yet-implemented tracking-dependent mode
        # (active_speaker/two_speakers/picture_in_picture/screen_gameplay —
        # see the `clip-formats` skill for which are still UI-locked) fall
        # back to the same plain centre-crop as before.
        chain = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}[v]"
        )
    if ass_path:
        escaped = str(ass_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        chain += f";[v]ass='{escaped}'[outv]"
    else:
        chain += ";[v]null[outv]"
    return chain


def render_clip(settings: Settings, input_url: str, edl: dict, ass_path: Path | None, output: Path) -> None:
    start_seconds = edl["range"]["startMs"] / 1000
    duration_seconds = (edl["range"]["endMs"] - edl["range"]["startMs"]) / 1000
    export = edl["export"]
    filter_complex = compile_video_filter(edl, ass_path)
    run_command([
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-y",
        "-ss", f"{start_seconds:.3f}",
        "-i", input_url,
        "-t", f"{duration_seconds:.3f}",
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-r", str(export.get("fps", 30)),
        "-b:v", f"{export.get('videoBitrateKbps', 6500)}k",
        "-maxrate", f"{int(export.get('videoBitrateKbps', 6500) * 1.25)}k",
        "-bufsize", f"{int(export.get('videoBitrateKbps', 6500) * 2)}k",
        "-c:a", "aac",
        "-b:a", f"{export.get('audioBitrateKbps', 160)}k",
        "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
        "-movflags", "+faststart",
        "-threads", "2",
        str(output),
    ], timeout_seconds=max(600, int(duration_seconds * 30)))
