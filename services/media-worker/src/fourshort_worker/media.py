from __future__ import annotations

from pathlib import Path
import re
import threading

from .config import Settings
from .process import run_command


def ffmpeg_thread_args(settings: Settings, *, filtergraph: bool = False) -> list[str]:
    """Return bounded FFmpeg thread flags for one worker-owned media process.

    ``SimpleNamespace`` settings are used by narrow unit fixtures, hence the
    conservative legacy fallback.  The production setting is clamped so an
    accidental environment value cannot make a single job claim unlimited
    cores.  This is an envelope guard, not a performance benchmark.
    """
    try:
        threads = int(getattr(settings, "ffmpeg_threads", 2))
    except (TypeError, ValueError):
        threads = 2
    threads = min(max(threads, 1), 8)
    args = ["-threads", str(threads)]
    if filtergraph:
        # The generic compositor itself must not recursively fan out threads.
        args.extend(["-filter_threads", str(threads), "-filter_complex_threads", str(threads)])
    return args


def probe_media(settings: Settings, input_url: str, *, cancellation_event: threading.Event | None = None) -> dict:
    result = run_command([
        settings.ffprobe_path,
        "-v", "error",
        "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,rotation",
        "-of", "json",
        input_url,
    ], timeout_seconds=120, capture_json=True, cancellation_event=cancellation_event)
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


def extract_audio(
    settings: Settings,
    input_url: str,
    output: Path,
    *,
    cancellation_event: threading.Event | None = None,
) -> None:
    run_command([
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-y",
        *ffmpeg_thread_args(settings),
        "-i", input_url,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "libmp3lame",
        "-b:a", "48k",
        str(output),
    ], timeout_seconds=4 * 60 * 60, cancellation_event=cancellation_event)


def create_browser_proxy(
    settings: Settings,
    input_url: str,
    output: Path,
    *,
    cancellation_event: threading.Event | None = None,
) -> dict[str, int | float]:
    """Create one bounded, broadly playable review proxy.

    Originals stay private and unchanged.  This profile exists only when the
    source cannot be played reliably in the browser (HEVC, unusual MOV audio,
    etc.), so we do not spend CPU/storage transcoding a normal H.264/AAC
    upload.  Both dimensions are capped at 720 px and made divisible by two;
    this is deliberately a review/perception artifact, never a user export.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    metrics: dict[str, int | float] = {}
    run_command([
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-y",
        *ffmpeg_thread_args(settings, filtergraph=True),
        "-i", input_url,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-vf", "scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "27",
        "-maxrate", "2200k",
        "-bufsize", "4400k",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "96k",
        "-movflags", "+faststart",
        str(output),
    ], timeout_seconds=4 * 60 * 60, process_metrics=metrics, cancellation_event=cancellation_event)
    if not output.is_file() or output.stat().st_size <= 0:
        raise JobError("PROXY_OUTPUT_MISSING", "Browser proxy was not created", retryable=True)
    return metrics


def verify_timed_brand_video(
    settings: Settings,
    path: Path,
    *,
    cancellation_event: threading.Event | None = None,
) -> dict:
    """Validate the deliberately narrow first timed-brand-media profile.

    HVE currently accepts only a quiet visual layer. Therefore both codec and
    pixel format are constrained here and a full decode is required before a
    stored asset can become renderer input. More permissive imports belong to
    a later explicit transcode stage, not to an accidental fallback in render.
    """
    probe = probe_media(settings, str(path), cancellation_event=cancellation_event)
    video = probe.get("video") or {}
    audio = probe.get("audio")
    duration_ms = int(probe.get("durationMs") or 0)
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    if (
        duration_ms < 40
        or duration_ms > 120_000
        or width <= 0 or height <= 0 or width > 3840 or height > 3840
        or video.get("codec_name") != "h264"
        or video.get("pix_fmt") != "yuv420p"
        or (audio is not None and audio.get("codec_name") != "aac")
    ):
        raise ValueError("HVE_TIMED_ASSET_PROFILE_UNSUPPORTED")
    _full_decode(settings, path, cancellation_event=cancellation_event)
    return {
        "profile": "hve-timed-visual-h264-aac-v1",
        "durationMs": duration_ms,
        "width": width,
        "height": height,
        "hasAudio": audio is not None,
        "audioPolicy": "muted_until_timed_audio_is_implemented",
    }


def _full_decode(settings: Settings, path: Path, *, cancellation_event: threading.Event | None = None) -> None:
    """Decode every stream before an output can become a downloadable artifact.

    `ffprobe` can successfully read a damaged MP4 header while a user receives
    a file that fails halfway through playback.  This bounded FFmpeg null mux
    pass catches that class of corruption without retaining frames or audio.
    """
    run_command([
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-v", "error",
        *ffmpeg_thread_args(settings),
        "-i", str(path),
        "-map", "0:v:0",
        "-map", "0:a?",
        "-f", "null", "-",
    ], timeout_seconds=_render_validation_timeout(path), cancellation_event=cancellation_event)


def _render_validation_timeout(path: Path) -> int:
    """Bound the verifier from the artifact size, never the source duration.

    A validation pass is a safety property, not another render queue.  The
    conservative 256 KiB/s floor leaves room for slow object-backed scratch
    while still terminating corrupt or stuck decoders.
    """
    return max(120, min(4 * 60 * 60, int(max(path.stat().st_size, 1) / (256 * 1024))))


_BLACK_SEGMENT_PATTERN = re.compile(
    r"black_start:(?P<start>-?\d+(?:\.\d+)?)\s+"
    r"black_end:(?P<end>-?\d+(?:\.\d+)?)\s+"
    r"black_duration:(?P<duration>-?\d+(?:\.\d+)?)"
)


def _black_segments_from_ffmpeg_log(stderr: str) -> list[dict[str, int]]:
    """Return compact output-clock observations from FFmpeg blackdetect logs.

    This is deliberately observation-only.  A black shot may be a valid
    creative decision, title card or a fade.  Product policy decides whether
    to surface a review warning; the integrity verifier never rejects a
    render merely because it contains dark frames.
    """
    segments: list[dict[str, int]] = []
    for match in _BLACK_SEGMENT_PATTERN.finditer(stderr):
        try:
            start_ms = max(0, round(float(match.group("start")) * 1000))
            end_ms = max(start_ms, round(float(match.group("end")) * 1000))
            duration_ms = max(0, round(float(match.group("duration")) * 1000))
        except ValueError:
            continue
        if duration_ms <= 0:
            continue
        segments.append({"startMs": start_ms, "endMs": end_ms, "durationMs": duration_ms})
        # A malformed or hostile filter log must not inflate a job response.
        if len(segments) >= 100:
            break
    return segments


def _decode_and_observe_visual_integrity(
    settings: Settings,
    path: Path,
    *,
    cancellation_event: threading.Event | None = None,
) -> dict:
    """Fully decode an artifact once and retain only bounded black-frame facts.

    Keeping this in the mandatory decode pass avoids a second full-media scan
    on a small worker.  If the installed FFmpeg lacks blackdetect, callers can
    fall back to a plain full decode and mark this optional observation as
    unavailable instead of claiming it passed.
    """
    stderr = run_command([
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-nostats", "-v", "info",
        *ffmpeg_thread_args(settings, filtergraph=True),
        "-i", str(path),
        "-filter_complex", "[0:v:0]blackdetect=d=0.80:pic_th=0.98:pix_th=0.10[hveqc]",
        "-map", "[hveqc]",
        "-map", "0:a?",
        "-f", "null", "-",
    ], timeout_seconds=_render_validation_timeout(path), capture_stderr=True, cancellation_event=cancellation_event)
    assert isinstance(stderr, str)
    black_segments = _black_segments_from_ffmpeg_log(stderr)
    return {
        "status": "observed",
        "blackSegments": black_segments,
        "reviewRecommended": bool(black_segments),
        "policy": "observation_only",
    }


def _parse_fps(stream: dict) -> float:
    raw = str(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1")
    try:
        numerator, denominator = raw.split("/", 1)
        return float(numerator) / max(float(denominator), 1.0)
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def validate_render(
    settings: Settings,
    path: Path,
    expected_duration_ms: int,
    expected_export: dict,
    *,
    expect_audio: bool,
    cancellation_event: threading.Event | None = None,
) -> dict:
    probe = probe_media(settings, str(path), cancellation_event=cancellation_event)
    video = probe.get("video") or {}
    audio = probe.get("audio")
    expected_width = int(expected_export["width"])
    expected_height = int(expected_export["height"])
    expected_fps = float(expected_export.get("fps", 30))
    actual_fps = _parse_fps(video)
    # One output frame plus muxer rounding is acceptable; the old fixed 1 s
    # tolerance could hide a bad time-map/cut render.
    duration_tolerance_ms = max(40, int(1000 / max(expected_fps, 1)) + 40)
    duration_delta = abs(probe["durationMs"] - expected_duration_ms)
    full_decode_error: str | None = None
    visual_integrity: dict
    try:
        visual_integrity = _decode_and_observe_visual_integrity(settings, path, cancellation_event=cancellation_event)
    except JobError as error:
        if error.code == "JOB_CANCELLED":
            raise
        # An older FFmpeg can lack blackdetect.  Preserve the non-negotiable
        # full decode check, but do not invent a visual-QC result in that case.
        try:
            _full_decode(settings, path, cancellation_event=cancellation_event)
            visual_integrity = {
                "status": "unavailable",
                "blackSegments": [],
                "reviewRecommended": False,
                "policy": "observation_only",
                "reason": "HVE_RENDER_VISUAL_QC_UNAVAILABLE",
            }
        except JobError as decode_error:
            if decode_error.code == "JOB_CANCELLED":
                raise
            full_decode_error = str(decode_error)
            visual_integrity = {
                "status": "unavailable",
                "blackSegments": [],
                "reviewRecommended": False,
                "policy": "observation_only",
                "reason": "HVE_RENDER_VISUAL_QC_UNAVAILABLE",
            }
        except Exception as decode_error:
            full_decode_error = str(decode_error)
            visual_integrity = {
                "status": "unavailable",
                "blackSegments": [],
                "reviewRecommended": False,
                "policy": "observation_only",
                "reason": "HVE_RENDER_VISUAL_QC_UNAVAILABLE",
            }
    except Exception as error:
        # An older FFmpeg can lack blackdetect.  Preserve the non-negotiable
        # full decode check, but do not invent a visual-QC result in that case.
        try:
            _full_decode(settings, path, cancellation_event=cancellation_event)
            visual_integrity = {
                "status": "unavailable",
                "blackSegments": [],
                "reviewRecommended": False,
                "policy": "observation_only",
                "reason": "HVE_RENDER_VISUAL_QC_UNAVAILABLE",
            }
        except JobError as decode_error:
            if decode_error.code == "JOB_CANCELLED":
                raise
            full_decode_error = str(decode_error)
            visual_integrity = {
                "status": "unavailable",
                "blackSegments": [],
                "reviewRecommended": False,
                "policy": "observation_only",
                "reason": "HVE_RENDER_VISUAL_QC_UNAVAILABLE",
            }
        except Exception as decode_error:
            full_decode_error = str(decode_error)
            visual_integrity = {
                "status": "unavailable",
                "blackSegments": [],
                "reviewRecommended": False,
                "policy": "observation_only",
                "reason": "HVE_RENDER_VISUAL_QC_UNAVAILABLE",
            }
    video_is_expected = (
        video.get("codec_name") == "h264"
        and video.get("pix_fmt") == "yuv420p"
        and video.get("width") == expected_width
        and video.get("height") == expected_height
        and abs(actual_fps - expected_fps) <= 0.15
    )
    audio_is_expected = not expect_audio or (audio is not None and audio.get("codec_name") == "aac")
    return {
        "valid": (
            video_is_expected
            and audio_is_expected
            and duration_delta <= duration_tolerance_ms
            and path.stat().st_size > 1024
            and full_decode_error is None
        ),
        "durationDeltaMs": duration_delta,
        "durationToleranceMs": duration_tolerance_ms,
        "actualFps": actual_fps,
        "expectedFps": expected_fps,
        "fullDecode": "passed" if full_decode_error is None else "failed",
        "fullDecodeError": full_decode_error,
        "visualIntegrity": visual_integrity,
        "probe": probe,
        "byteSize": path.stat().st_size,
    }
