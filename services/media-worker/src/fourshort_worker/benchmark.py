"""Reproducible, non-customer HVE worker benchmark.

This module is deliberately a deployment/operator tool, not a worker stage.
It renders only FFmpeg lavfi fixtures, records bounded resource facts and
never contacts the control API, S3 or an AI provider.  Its report is evidence
for a candidate hardware baseline; it cannot by itself approve HVE-G7.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
from typing import Any

import psutil

from .process import run_command
from .resources import cgroup_cpu_limit_cores, cgroup_memory_limit_bytes


DEFAULT_DURATION_SECONDS = 60
MIN_PRODUCTION_DURATION_SECONDS = 30


def realtime_factor(wall_seconds: float, source_seconds: float) -> float | None:
    if wall_seconds < 0 or source_seconds <= 0:
        return None
    return round(wall_seconds / source_seconds, 4)


def _command_version(binary: str) -> str | None:
    try:
        completed = subprocess.run(
            [binary, "-version"],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.splitlines()[0] if completed.stdout else None


def _command_version_fingerprint(binary: str) -> str | None:
    """Fingerprint the complete FFmpeg build, not merely its first line.

    FFmpeg package updates can change encoders and performance materially while
    keeping a familiar version prefix.  The evaluator uses this hash to reject
    an apples-to-oranges baseline comparison until it is deliberately renewed.
    """
    try:
        completed = subprocess.run(
            [binary, "-version"],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return hashlib.sha256(completed.stdout).hexdigest()


def _cpu_model() -> str | None:
    """Read the kernel-reported CPU model when ``platform`` leaves it blank."""
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition(":")
            if separator and key.strip().lower() in {"model name", "hardware", "processor"} and value.strip():
                return value.strip()
    except OSError:
        pass
    value = platform.processor().strip()
    return value or None


def hardware_fingerprint(scratch_root: Path, *, ffmpeg_path: str) -> dict[str, Any]:
    disk = shutil.disk_usage(scratch_root)
    memory = psutil.virtual_memory()
    cgroup_limit = cgroup_memory_limit_bytes()
    cgroup_cpu_limit = cgroup_cpu_limit_cores()
    logical_cpu = os.cpu_count() or 1
    return {
        "hostname": platform.node(),
        "platform": platform.platform(),
        "kernel": platform.release(),
        "python": sys.version.split()[0],
        "ffmpeg": _command_version(ffmpeg_path),
        "ffmpegBuildSha256": _command_version_fingerprint(ffmpeg_path),
        # The immutable OCI digest is injected by deploy.  A local smoke may
        # leave this null, but such a report cannot become a hardware baseline.
        "imageDigest": os.environ.get("FOURSHORT_WORKER_IMAGE_DIGEST") or None,
        "logicalCpu": logical_cpu,
        "cgroupCpuLimitCores": cgroup_cpu_limit,
        "effectiveCpuCores": cgroup_cpu_limit or float(logical_cpu),
        "cpuModel": _cpu_model(),
        "hostMemoryBytes": memory.total,
        "cgroupMemoryLimitBytes": cgroup_limit,
        "effectiveMemoryBytes": cgroup_limit or memory.total,
        "scratchPath": str(scratch_root),
        "scratchTotalBytes": disk.total,
        "scratchFreeBytesBefore": disk.free,
    }


def _run_ffmpeg(args: list[str], *, timeout_seconds: int) -> dict[str, int | float]:
    metrics: dict[str, int | float] = {}
    run_command(args, timeout_seconds=timeout_seconds, process_metrics=metrics)
    return metrics


def benchmark_fixture(
    *,
    scratch_root: Path,
    ffmpeg_path: str,
    ffprobe_path: str,
    duration_seconds: int,
    threads: int,
) -> dict[str, Any]:
    """Generate and fully validate one deterministic 1080x1920 render.

    Source generation and the measured vertical render are separated.  The
    report records only the latter RTF, so provisioning disk or source fixture
    cost does not inflate the service execution measurement.
    """
    scratch_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    fixture = scratch_root / "hve-benchmark-source.mp4"
    output = scratch_root / "hve-benchmark-output.mp4"
    timeout_seconds = max(180, duration_seconds * 12)
    thread_args = ["-threads", str(max(1, min(threads, 8)))]

    generate_metrics = _run_ffmpeg([
        ffmpeg_path, "-hide_banner", "-nostdin", "-y",
        *thread_args,
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=997:sample_rate=48000",
        "-t", str(duration_seconds),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(fixture),
    ], timeout_seconds=timeout_seconds)

    render_metrics = _run_ffmpeg([
        ffmpeg_path, "-hide_banner", "-nostdin", "-y",
        *thread_args, "-filter_threads", str(max(1, min(threads, 8))),
        "-i", str(fixture),
        "-filter_complex", "[0:v:0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[v]",
        "-map", "[v]", "-map", "0:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(output),
    ], timeout_seconds=timeout_seconds)

    probe = run_command([
        ffprobe_path, "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", str(output),
    ], timeout_seconds=60, capture_json=True)
    assert isinstance(probe, dict)
    streams = probe.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    if video.get("codec_name") != "h264" or video.get("width") != 1080 or video.get("height") != 1920 or audio.get("codec_name") != "aac":
        raise RuntimeError("benchmark output profile mismatch")
    _run_ffmpeg([
        ffmpeg_path, "-hide_banner", "-nostdin", "-v", "error", *thread_args,
        "-i", str(output), "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-",
    ], timeout_seconds=timeout_seconds)

    output_duration_seconds = float(probe.get("format", {}).get("duration", 0) or 0)
    return {
        "fixture": {
            "sourceDurationSeconds": duration_seconds,
            "sourceResolution": "1280x720",
            "outputResolution": "1080x1920",
            "fps": 30,
            "encoder": "libx264/veryfast",
            "audio": "aac/128k",
        },
        "generation": generate_metrics,
        "render": {
            **render_metrics,
            "outputDurationSeconds": round(output_duration_seconds, 3),
            "realtimeFactor": realtime_factor(float(render_metrics.get("subprocessWallSeconds", 0)), output_duration_seconds),
            "outputBytes": output.stat().st_size,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a non-customer HVE FFmpeg hardware benchmark")
    parser.add_argument("--output", required=True, help="Path to the JSON report outside the runtime scratch directory")
    parser.add_argument("--scratch-root", default="/var/lib/4short/benchmark", help="Writable temporary benchmark directory")
    parser.add_argument("--duration-seconds", type=int, default=DEFAULT_DURATION_SECONDS)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--allow-short", action="store_true", help="Permit <30 s only for smoke/CI; never use as a hardware baseline")
    args = parser.parse_args()

    if args.duration_seconds <= 0 or (args.duration_seconds < MIN_PRODUCTION_DURATION_SECONDS and not args.allow_short):
        parser.error("--duration-seconds must be at least 30 unless --allow-short is explicit")
    if args.threads < 1 or args.threads > 8:
        parser.error("--threads must be between 1 and 8")

    scratch_root = Path(args.scratch_root).resolve()
    output_path = Path(args.output).resolve()
    if output_path.parent == scratch_root or scratch_root in output_path.parents:
        parser.error("--output must be outside --scratch-root so cleanup cannot destroy benchmark evidence")
    scratch_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    output_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    environment = hardware_fingerprint(scratch_root, ffmpeg_path=args.ffmpeg)
    started_at = time.time()
    status = "PASS"
    error: str | None = None
    result: dict[str, Any] | None = None
    try:
        result = benchmark_fixture(
            scratch_root=scratch_root,
            ffmpeg_path=args.ffmpeg,
            ffprobe_path=args.ffprobe,
            duration_seconds=args.duration_seconds,
            threads=args.threads,
        )
    except Exception as exc:  # Report failures; do not lose the machine facts.
        status = "FAIL"
        error = str(exc)
    finally:
        environment["scratchFreeBytesAfter"] = shutil.disk_usage(scratch_root).free if scratch_root.exists() else None

    report = {
        "schemaVersion": 1,
        "kind": "hve-worker-benchmark",
        "status": status,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at)),
        "scope": "Synthetic FFmpeg resource sample only. It is not a corpus, queue-fairness, or production gate PASS.",
        "benchmark": {
            "threads": args.threads,
            "durationSeconds": args.duration_seconds,
        },
        "environment": environment,
        "result": result,
        "error": error,
    }
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"HVE worker benchmark {status}: {output_path}")
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
