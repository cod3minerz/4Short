"""Run evaluator-only active-speaker candidate inference for one corpus item."""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import tempfile
import time
from typing import Any

from fourshort_worker import association as association_module
from fourshort_worker.active_speaker_evidence import compile_active_speaker_evidence, evidence_sha256

from .diarization import DiarizationRuntimeError, run_sherpa_diarization
from .model_manifest import ModelManifestError, verify_evaluator_models
from .mouth_activity import MouthActivityRuntimeError, run_mediapipe_mouth_activity


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _write_once(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        payload = (_canonical_json(value) + "\n").encode("utf-8")
        written = 0
        while written < len(payload):
            count = os.write(descriptor, payload[written:])
            if count <= 0:
                raise OSError("cannot write evaluator evidence artifact")
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _prepare_staging_directory(output_dir: Path) -> Path:
    """Create a private sibling directory for an all-or-nothing candidate run.

    Candidate evidence is only meaningful when its diarization, visual-motion,
    association and provenance records describe the same completed run.  A
    failed evaluator must therefore never publish the first three files and
    leave out the final provenance record.  Building in a sibling directory
    and atomically renaming it on success gives readers a completed bundle or
    no bundle at all.

    Reusing an output path is deliberately rejected.  It would otherwise make
    a new model run look like it had produced bytes from an earlier run.
    """
    if os.path.lexists(output_dir):
        raise ValueError("candidate output directory already exists")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.staging-", dir=output_dir.parent))


def _publish_staging_directory(*, staging_dir: Path, output_dir: Path) -> None:
    """Publish a complete evidence bundle without overwriting prior evidence."""
    if os.path.lexists(output_dir):
        raise ValueError("candidate output directory already exists")
    os.replace(staging_dir, output_dir)


def _peak_rss_bytes() -> int:
    """Return a conservative process-tree peak while evaluator runs locally.

    The evaluator bundle is only eligible for promotion if the builder later
    sees cgroup-v2 measurements.  This fallback is retained for unit tests and
    developer diagnosis, where a host may not expose the container cgroup.
    """
    if os.name != "posix" or not Path("/proc/self/status").is_file():
        raise RuntimeError("HVE evaluator measurements require Linux /proc")
    own = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1_024
    children = int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss) * 1_024
    return max(own, children)


def _cgroup_v2_path() -> Path | None:
    """Resolve the current cgroup-v2 directory without trusting an env var."""
    try:
        for line in Path("/proc/self/cgroup").read_text(encoding="utf-8").splitlines():
            hierarchy, controllers, relative = line.split(":", 2)
            if hierarchy == "0" and controllers == "":
                path = (Path("/sys/fs/cgroup") / relative.lstrip("/")).resolve()
                root = Path("/sys/fs/cgroup").resolve()
                if root == path or root in path.parents:
                    return path
    except (OSError, ValueError):
        return None
    return None


def _read_cgroup_number(name: str) -> int | None:
    directory = _cgroup_v2_path()
    if directory is None:
        return None
    try:
        raw = (directory / name).read_text(encoding="utf-8").strip()
        if raw == "max":
            return None
        value = int(raw)
    except (OSError, ValueError):
        return None
    return value if value >= 0 else None


def _process_age_seconds() -> float | None:
    """Approximate cold start from the kernel process start tick on Linux.

    It starts when the candidate process begins, so it includes Python module
    loading and model initialization rather than only the inference function.
    This is intentionally not a container boot metric.
    """
    try:
        stat = Path("/proc/self/stat").read_text(encoding="utf-8")
        closing = stat.rfind(")")
        fields = stat[closing + 2 :].split()
        # /proc/<pid>/stat field 22 (starttime); fields start at original 3.
        start_ticks = int(fields[19])
        uptime = float(Path("/proc/uptime").read_text(encoding="utf-8").split()[0])
        ticks_per_second = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
        return max(0.0, uptime - start_ticks / ticks_per_second)
    except (OSError, ValueError, IndexError, KeyError):
        return None


def _measurement(started: float, duration_ms: int) -> dict[str, Any]:
    cgroup_peak = _read_cgroup_number("memory.peak")
    cgroup_swap_peak = _read_cgroup_number("memory.swap.peak")
    if cgroup_peak is not None and cgroup_swap_peak is not None:
        return {
            "scope": "cgroup-v2",
            "peakRssBytes": cgroup_peak,
            "sustainedSwapBytes": cgroup_swap_peak,
            "wallSeconds": round(time.monotonic() - started, 6),
            "mediaSeconds": duration_ms / 1_000,
            "coldStartSeconds": round(_process_age_seconds() or 0.0, 6),
        }
    return {
        "scope": "process-fallback",
        "peakRssBytes": _peak_rss_bytes(),
        "sustainedSwapBytes": 0,
        "wallSeconds": round(time.monotonic() - started, 6),
        "mediaSeconds": duration_ms / 1_000,
        "coldStartSeconds": round(_process_age_seconds() or 0.0, 6),
    }


def _extract_pcm16_audio(*, source_video: Path, scratch_dir: Path) -> Path:
    """Derive evaluator audio from the exact hashed video, never a caller WAV.

    Accepting an arbitrary audio file with merely a matching duration could
    associate one video's faces with another conversation.  The audio is kept
    in an evaluator scratch directory only and is deleted after the candidate
    run; it never crosses the evidence boundary.
    """
    scratch_dir.mkdir(parents=True, exist_ok=True)
    descriptor, raw_path = tempfile.mkstemp(prefix="hve-evaluator-", suffix=".wav", dir=scratch_dir)
    os.close(descriptor)
    audio_path = Path(raw_path)
    try:
        completed = subprocess.run(
            [
                "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source_video),
                "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        audio_path.unlink(missing_ok=True)
        raise ValueError("cannot extract mono 16 kHz audio from the hashed source video") from error
    if completed.returncode != 0 or not audio_path.is_file() or audio_path.stat().st_size < 44:
        audio_path.unlink(missing_ok=True)
        raise ValueError("cannot extract mono 16 kHz audio from the hashed source video")
    return audio_path


def run_candidate(
    *,
    source_video: Path,
    source_hash: str,
    duration_ms: int,
    models_manifest: Path,
    model_root: Path,
    output_dir: Path,
    scratch_dir: Path,
    analysis_id: str,
    source_id: str,
) -> dict[str, Any]:
    """Create bounded candidate artifacts for an evaluator-owned corpus item."""
    if source_hash.lower() != _file_sha256(source_video):
        raise ValueError("source video SHA-256 does not match --source-hash")
    staging_dir = _prepare_staging_directory(output_dir)
    try:
        models = verify_evaluator_models(manifest_path=models_manifest, model_root=model_root)
        started = time.monotonic()
        audio_path = _extract_pcm16_audio(source_video=source_video, scratch_dir=scratch_dir)
        try:
            diarization = run_sherpa_diarization(
                audio_path=audio_path,
                source_hash=source_hash.lower(),
                duration_ms=duration_ms,
                model_set=models,
            )
            mouth_activity = run_mediapipe_mouth_activity(
                video_path=source_video,
                source_hash=source_hash.lower(),
                duration_ms=duration_ms,
                model_set=models,
            )
        finally:
            audio_path.unlink(missing_ok=True)
        artifact = compile_active_speaker_evidence(
            analysis_id=analysis_id,
            source_id=source_id,
            engine_version="hve-active-speaker-candidate-v1",
            diarization_evidence=diarization,
            mouth_evidence=mouth_activity,
        )
        metadata = {
            "schemaVersion": 1,
            "kind": "hve-active-speaker-candidate-run-v1",
            "sourceHash": source_hash.lower(),
            "durationMs": duration_ms,
            "modelManifestFingerprint": models.fingerprint,
            "diarizationEvidenceSha256": evidence_sha256(diarization),
            "mouthEvidenceSha256": evidence_sha256(mouth_activity),
            "activeSpeakerArtifactSha256": artifact["artifactHash"],
            "associationCodeSha256": _file_sha256(Path(association_module.__file__).resolve()),
            "measurement": _measurement(started, duration_ms),
        }
        _write_once(staging_dir / "diarization.json", diarization)
        _write_once(staging_dir / "mouth-activity.json", mouth_activity)
        _write_once(staging_dir / "active-speaker-artifact.json", artifact)
        _write_once(staging_dir / "candidate-run.json", metadata)
        _publish_staging_directory(staging_dir=staging_dir, output_dir=output_dir)
        return metadata
    except BaseException:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the evaluator-only HVE active-speaker candidate.")
    parser.add_argument("--source-video", required=True, type=Path)
    parser.add_argument("--source-hash", required=True)
    parser.add_argument("--duration-ms", required=True, type=int)
    parser.add_argument("--models-manifest", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--scratch-dir", required=True, type=Path)
    parser.add_argument("--analysis-id", required=True)
    parser.add_argument("--source-id", required=True)
    arguments = parser.parse_args()
    try:
        metadata = run_candidate(
            source_video=arguments.source_video,
            source_hash=arguments.source_hash,
            duration_ms=arguments.duration_ms,
            models_manifest=arguments.models_manifest,
            model_root=arguments.model_root,
            output_dir=arguments.output_dir,
            scratch_dir=arguments.scratch_dir,
            analysis_id=arguments.analysis_id,
            source_id=arguments.source_id,
        )
    except (OSError, ValueError, ModelManifestError, DiarizationRuntimeError, MouthActivityRuntimeError) as error:
        parser.exit(2, f"HVE active-speaker candidate rejected: {error}\n")
    print(json.dumps({"status": "completed", "outputDir": str(arguments.output_dir), "measurement": metadata["measurement"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
