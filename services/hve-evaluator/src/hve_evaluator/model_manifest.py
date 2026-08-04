"""Strict, evaluator-only model provenance and file verification.

HVE-G5 candidate models are intentionally not downloaded by an image build or
an active job.  A release evaluator provisions approved files into a private
mount, writes this manifest and verifies every byte before inference.  This
keeps a model revision, license and checksum bound to the benchmark evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any


class ModelManifestError(ValueError):
    """Raised when a candidate evaluator model pack is missing or mutable."""


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ALLOWED_KINDS = {
    "sherpa_segmentation",
    "sherpa_embedding",
    "mediapipe_face_landmarker",
}


@dataclass(frozen=True)
class VerifiedEvaluatorModel:
    model_id: str
    kind: str
    path: Path
    sha256: str
    version: str
    license_ref: str
    source_url: str


@dataclass(frozen=True)
class VerifiedEvaluatorModelSet:
    fingerprint: str
    models: dict[str, VerifiedEvaluatorModel]

    def require(self, kind: str) -> VerifiedEvaluatorModel:
        matches = [model for model in self.models.values() if model.kind == kind]
        if len(matches) != 1:
            raise ModelManifestError(f"evaluator manifest requires exactly one {kind} model")
        return matches[0]


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _require_string(value: Any, label: str, *, minimum: int = 1) -> str:
    if not isinstance(value, str) or len(value.strip()) < minimum:
        raise ModelManifestError(f"{label} must be a non-empty string")
    return value.strip()


def _safe_model_path(root: Path, raw_path: Any) -> Path:
    relative = _require_string(raw_path, "model.path")
    candidate = Path(relative)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise ModelManifestError("model.path must be a safe relative path")
    resolved_root = root.resolve()
    resolved = (resolved_root / candidate).resolve()
    if resolved_root not in resolved.parents:
        raise ModelManifestError("model.path escapes evaluator model root")
    return resolved


def _manifest_payload(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": value.get("schemaVersion"),
        "kind": value.get("kind"),
        "models": value.get("models"),
    }


def verify_evaluator_models(*, manifest_path: Path, model_root: Path) -> VerifiedEvaluatorModelSet:
    """Verify model paths, source/license metadata and byte hashes once.

    The manifest syntax is intentionally small and closed.  It must identify
    each model's immutable source URL and license reference; a bare file copied
    into a mount is not valid evaluator evidence.
    """
    try:
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ModelManifestError("cannot read evaluator model manifest") from error
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "kind", "models", "fingerprint"}:
        raise ModelManifestError("evaluator model manifest has unexpected fields")
    if value.get("schemaVersion") != 1 or value.get("kind") != "hve-evaluator-models-v1":
        raise ModelManifestError("unsupported evaluator model manifest")
    payload = _manifest_payload(value)
    expected_fingerprint = sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
    if value.get("fingerprint") != expected_fingerprint:
        raise ModelManifestError("evaluator model manifest fingerprint does not match contents")
    raw_models = value.get("models")
    if not isinstance(raw_models, list) or len(raw_models) != 3:
        raise ModelManifestError("evaluator model manifest requires exactly three model records")

    verified: dict[str, VerifiedEvaluatorModel] = {}
    kinds: set[str] = set()
    for index, raw in enumerate(raw_models):
        if not isinstance(raw, dict) or set(raw) != {"id", "kind", "path", "sha256", "version", "licenseRef", "sourceUrl"}:
            raise ModelManifestError(f"models[{index}] has unexpected fields")
        model_id = _require_string(raw.get("id"), f"models[{index}].id")
        kind = _require_string(raw.get("kind"), f"models[{index}].kind")
        if kind not in _ALLOWED_KINDS or kind in kinds or model_id in verified:
            raise ModelManifestError(f"models[{index}] has duplicate or unsupported identity")
        digest = _require_string(raw.get("sha256"), f"models[{index}].sha256", minimum=64).lower()
        if not _SHA256.fullmatch(digest):
            raise ModelManifestError(f"models[{index}].sha256 must be a SHA-256 digest")
        path = _safe_model_path(model_root, raw.get("path"))
        if not path.is_file() or path.is_symlink():
            raise ModelManifestError(f"models[{index}] is missing or a symbolic link")
        if _file_sha256(path) != digest:
            raise ModelManifestError(f"models[{index}] byte hash does not match the manifest")
        verified[model_id] = VerifiedEvaluatorModel(
            model_id=model_id,
            kind=kind,
            path=path,
            sha256=digest,
            version=_require_string(raw.get("version"), f"models[{index}].version"),
            license_ref=_require_string(raw.get("licenseRef"), f"models[{index}].licenseRef"),
            source_url=_require_string(raw.get("sourceUrl"), f"models[{index}].sourceUrl", minimum=8),
        )
        kinds.add(kind)
    if kinds != _ALLOWED_KINDS:
        raise ModelManifestError("evaluator model manifest has an incomplete model set")
    return VerifiedEvaluatorModelSet(fingerprint=expected_fingerprint, models=verified)
