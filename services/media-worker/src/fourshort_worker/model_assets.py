"""Immutable local Faster-Whisper model packs.

The media worker must never fetch a model while holding a customer's job
lease.  Apart from unpredictable latency, that makes a model update an
invisible change to transcript quality.  A model is therefore provisioned as
an explicit, hashed pack before the worker is started.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path
from typing import Any

from .errors import JobError


MODEL_MANIFEST_NAME = "hve-model-manifest.json"
MODEL_MANIFEST_SCHEMA_VERSION = 1
REQUIRED_FASTER_WHISPER_FILES = ("config.json", "model.bin", "tokenizer.json")


@dataclass(frozen=True)
class VerifiedSttModel:
    path: Path
    fingerprint: str
    revision: str
    source: str


@dataclass(frozen=True)
class VerifiedFaceDetector:
    path: Path
    fingerprint: str


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_path(value: object) -> Path:
    if not isinstance(value, str) or not value or value.startswith("/"):
        raise ValueError("model manifest has an invalid file path")
    path = Path(value)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("model manifest contains a non-relative file path")
    return path


def _canonical_fingerprint(payload: dict[str, Any]) -> str:
    return sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def build_model_manifest(model_dir: Path, *, model: str, source: str, revision: str) -> dict[str, Any]:
    """Create a deterministic manifest after a trusted provisioning download."""
    if not model_dir.is_dir():
        raise ValueError("model directory does not exist")
    files: list[dict[str, Any]] = []
    for path in sorted(model_dir.rglob("*")):
        if not path.is_file() or path.name == MODEL_MANIFEST_NAME:
            continue
        relative = path.relative_to(model_dir)
        if path.is_symlink():
            raise ValueError("model pack may not contain symbolic links")
        files.append({
            "path": relative.as_posix(),
            "sha256": _file_sha256(path),
            "byteSize": path.stat().st_size,
        })
    payload: dict[str, Any] = {
        "schemaVersion": MODEL_MANIFEST_SCHEMA_VERSION,
        "model": model,
        "source": source,
        "revision": revision,
        "files": files,
    }
    payload["fingerprint"] = _canonical_fingerprint(payload)
    return payload


def write_model_manifest(model_dir: Path, *, model: str, source: str, revision: str) -> str:
    manifest = build_model_manifest(model_dir, model=model, source=source, revision=revision)
    destination = model_dir / MODEL_MANIFEST_NAME
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(manifest["fingerprint"])


def verify_local_stt_model(settings) -> VerifiedSttModel:
    """Verify a configured model pack and return only a local model directory.

    `WhisperModel` receives this directory rather than a Hugging Face model
    name.  This deliberately removes Faster-Whisper's download-on-demand
    behaviour from production job execution.
    """
    model_dir = Path(settings.stt_model_path)
    configured_manifest_path = getattr(settings, "stt_model_manifest", None)
    manifest_path = Path(configured_manifest_path) if configured_manifest_path else model_dir / MODEL_MANIFEST_NAME
    return _verify_model_pack(
        str(model_dir),
        str(manifest_path),
        str(settings.stt_model),
        str(getattr(settings, "stt_model_fingerprint", "") or ""),
    )


@lru_cache(maxsize=4)
def _verify_model_pack(
    model_dir_value: str,
    manifest_path_value: str,
    configured_model: str,
    configured_fingerprint: str,
) -> VerifiedSttModel:
    """Hash one immutable model pack once per worker process.

    The deployment operation makes model files root-owned and read-only for
    the worker. Re-hashing a 1–2 GiB model for every source would otherwise
    turn the verifier into the bottleneck it is meant to prevent.
    """
    model_dir = Path(model_dir_value)
    if not model_dir.is_dir():
        raise JobError("STT_MODEL_UNAVAILABLE", "The local Whisper model pack is not installed", retryable=False)
    if model_dir.is_symlink():
        raise JobError("STT_MODEL_INVALID", "The local Whisper model pack may not be a symbolic link", retryable=False)

    manifest_path = Path(manifest_path_value)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JobError("STT_MODEL_MANIFEST_MISSING", "The local Whisper model manifest is missing or invalid", retryable=False) from error
    if not isinstance(manifest, dict):
        raise JobError("STT_MODEL_MANIFEST_INVALID", "The local Whisper model manifest is invalid", retryable=False)

    files = manifest.get("files")
    expected = {
        "schemaVersion": manifest.get("schemaVersion"),
        "model": manifest.get("model"),
        "source": manifest.get("source"),
        "revision": manifest.get("revision"),
        "files": files,
    }
    if (
        manifest.get("schemaVersion") != MODEL_MANIFEST_SCHEMA_VERSION
        or manifest.get("model") != configured_model
        or not isinstance(manifest.get("source"), str)
        or not isinstance(manifest.get("revision"), str)
        or not isinstance(files, list)
        or manifest.get("fingerprint") != _canonical_fingerprint(expected)
    ):
        raise JobError("STT_MODEL_MANIFEST_INVALID", "The local Whisper model manifest does not match its contents", retryable=False)

    if not configured_fingerprint or configured_fingerprint != manifest["fingerprint"]:
        raise JobError("STT_MODEL_FINGERPRINT_MISMATCH", "The configured Whisper model fingerprint does not match the installed pack", retryable=False)

    found: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            raise JobError("STT_MODEL_MANIFEST_INVALID", "The local Whisper model manifest has an invalid file record", retryable=False)
        try:
            relative = _safe_relative_path(item.get("path"))
        except ValueError as error:
            raise JobError("STT_MODEL_MANIFEST_INVALID", str(error), retryable=False) from error
        path = model_dir / relative
        if not path.is_file() or path.is_symlink() or path.stat().st_size != item.get("byteSize"):
            raise JobError("STT_MODEL_TAMPERED", "A local Whisper model file is missing or changed", retryable=False)
        if not isinstance(item.get("sha256"), str) or _file_sha256(path) != item["sha256"]:
            raise JobError("STT_MODEL_TAMPERED", "A local Whisper model file checksum does not match", retryable=False)
        found.add(relative.as_posix())

    if not set(REQUIRED_FASTER_WHISPER_FILES).issubset(found):
        raise JobError("STT_MODEL_INCOMPLETE", "The local Whisper model pack is incomplete", retryable=False)
    actual = {
        path.relative_to(model_dir).as_posix()
        for path in model_dir.rglob("*")
        if path.is_file() and path.name != MODEL_MANIFEST_NAME
    }
    if actual != found:
        raise JobError("STT_MODEL_TAMPERED", "The local Whisper model pack contains files outside its manifest", retryable=False)
    return VerifiedSttModel(
        path=model_dir,
        fingerprint=manifest["fingerprint"],
        revision=manifest["revision"],
        source=manifest["source"],
    )


def stt_model_readiness(settings) -> tuple[bool, str]:
    """A non-throwing readiness report used while advertising worker capacity."""
    try:
        verified = verify_local_stt_model(settings)
        return True, verified.fingerprint
    except JobError as error:
        return False, error.code


def _is_sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value.lower())


def verify_face_detector_model(settings) -> VerifiedFaceDetector:
    """Verify the compact YuNet artifact bundled in the worker image.

    Checking only ``Path.is_file`` lets an accidental bind mount or a mutable
    host file change all crop decisions without changing an engine release.
    Unlike the multi-file Whisper pack, YuNet is one small immutable ONNX file
    so verifying it at worker start costs practically nothing.
    """
    return _verify_face_detector(
        str(Path(settings.face_detector_model)),
        str(getattr(settings, "face_detector_fingerprint", "") or ""),
    )


@lru_cache(maxsize=4)
def _verify_face_detector(model_path_value: str, configured_fingerprint: str) -> VerifiedFaceDetector:
    model_path = Path(model_path_value)
    if not model_path.is_file():
        raise JobError("FACE_MODEL_UNAVAILABLE", "The YuNet face detector is not installed", retryable=False)
    if model_path.is_symlink():
        raise JobError("FACE_MODEL_INVALID", "The YuNet face detector may not be a symbolic link", retryable=False)
    if not configured_fingerprint or not _is_sha256(configured_fingerprint):
        raise JobError("FACE_MODEL_FINGERPRINT_MISSING", "The YuNet face detector fingerprint is missing", retryable=False)
    if _file_sha256(model_path) != configured_fingerprint:
        raise JobError("FACE_MODEL_TAMPERED", "The YuNet face detector checksum does not match", retryable=False)
    return VerifiedFaceDetector(path=model_path, fingerprint=configured_fingerprint)


def face_detector_readiness(settings) -> tuple[bool, str]:
    """Return a capability-safe YuNet readiness state without throwing."""
    if not settings.face_tracking_enabled:
        return False, "FACE_TRACKING_DISABLED"
    try:
        detector = verify_face_detector_model(settings)
        return True, detector.fingerprint
    except JobError as error:
        return False, error.code
