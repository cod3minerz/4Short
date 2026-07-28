from __future__ import annotations

from pathlib import Path

from .config import Settings
from .process import run_command


def probe_media(settings: Settings, input_url: str) -> dict:
    result = run_command([
        settings.ffprobe_path,
        "-v", "error",
        "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,rotation",
        "-of", "json",
        input_url,
    ], timeout_seconds=120, capture_json=True)
    assert isinstance(result, dict)
    duration = float(result.get("format", {}).get("duration", 0) or 0)
    streams = result.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    return {
        "durationMs": round(duration * 1000),
        "format": result.get("format", {}).get("format_name"),
        "video": video,
        "audio": audio,
        "browserCompatible": bool(
            video and audio
            and video.get("codec_name") == "h264"
            and audio.get("codec_name") == "aac"
        ),
    }


def extract_audio(settings: Settings, input_url: str, output: Path) -> None:
    run_command([
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-y",
        "-i", input_url,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "libmp3lame",
        "-b:a", "48k",
        str(output),
    ], timeout_seconds=4 * 60 * 60)


def validate_render(settings: Settings, path: Path, expected_duration_ms: int) -> dict:
    probe = probe_media(settings, str(path))
    video = probe.get("video") or {}
    audio = probe.get("audio")
    duration_delta = abs(probe["durationMs"] - expected_duration_ms)
    return {
        "valid": (
            video.get("width") in {720, 1080}
            and video.get("height") in {1280, 1920}
            and audio is not None
            and duration_delta <= 1000
            and path.stat().st_size > 1024
        ),
        "durationDeltaMs": duration_delta,
        "probe": probe,
        "byteSize": path.stat().st_size,
    }
