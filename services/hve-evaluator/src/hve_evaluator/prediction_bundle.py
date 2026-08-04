"""Assemble an unsigned, evidence-bound HVE-G5 prediction bundle.

This module intentionally lives in the evaluator image.  Product services
must never be able to manufacture benchmark predictions from customer media or
edit evaluator mappings.  A human evaluator maps anonymous candidate speaker
and face IDs to sealed corpus labels; this code only verifies that mapping and
binds it to the compact artifacts emitted by :mod:`active_speaker_candidate`.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from typing import Any

from .model_manifest import ModelManifestError, verify_evaluator_models


class PredictionBundleError(ValueError):
    """Raised when evaluator-owned prediction provenance is incomplete."""


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAPPING_KEYS = {"itemId", "sourceHash", "candidateOutput", "speakers", "faces"}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _sha256(value: Any) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _require_hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value.lower()):
        raise PredictionBundleError(f"{label} must be a SHA-256 digest")
    return value.lower()


def _require_string(value: Any, label: str, *, minimum: int = 1) -> str:
    if not isinstance(value, str) or len(value.strip()) < minimum:
        raise PredictionBundleError(f"{label} must be a non-empty string")
    return value.strip()


def _require_nonnegative_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise PredictionBundleError(f"{label} must be a non-negative number")
    return float(value)


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PredictionBundleError(f"cannot read {label}") from error
    if not isinstance(value, dict):
        raise PredictionBundleError(f"{label} must be an object")
    return value


def _safe_child(root: Path, raw: Any, label: str) -> Path:
    relative = Path(_require_string(raw, label))
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise PredictionBundleError(f"{label} must be a safe relative directory")
    resolved_root = root.resolve()
    target = (resolved_root / relative).resolve()
    if target == resolved_root or resolved_root not in target.parents:
        raise PredictionBundleError(f"{label} escapes candidate root")
    return target


def _require_mapping(value: Any, label: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise PredictionBundleError(f"{label} must be an object")
    result: dict[str, str] = {}
    for candidate_id, sealed_id in value.items():
        result[_require_string(candidate_id, f"{label} key")] = _require_string(sealed_id, f"{label}.{candidate_id}")
    if len(set(result.values())) != len(result):
        raise PredictionBundleError(f"{label} must be one-to-one")
    return result


def _verify_artifact(value: dict[str, Any], run: dict[str, Any], mapping: dict[str, Any]) -> list[dict[str, Any]]:
    source_hash = _require_hash(value.get("sourceHash"), "artifact.sourceHash")
    if source_hash != _require_hash(run.get("sourceHash"), "candidate run.sourceHash"):
        raise PredictionBundleError("candidate run and association artifact do not bind the same source")
    if source_hash != _require_hash(mapping.get("sourceHash"), "mapping.sourceHash"):
        raise PredictionBundleError("mapping and association artifact do not bind the same source")
    claimed_artifact_hash = _require_hash(value.get("artifactHash"), "artifact.artifactHash")
    unsigned = {key: item for key, item in value.items() if key != "artifactHash"}
    if claimed_artifact_hash != _sha256(unsigned):
        raise PredictionBundleError("association artifact hash does not match canonical contents")
    if claimed_artifact_hash != _require_hash(run.get("activeSpeakerArtifactSha256"), "candidate run.activeSpeakerArtifactSha256"):
        raise PredictionBundleError("candidate run does not bind the association artifact")
    if not isinstance(value.get("activeSpeakerLinks"), list):
        raise PredictionBundleError("association artifact.activeSpeakerLinks must be an array")
    duration_us = value.get("durationUs")
    if isinstance(duration_us, bool) or not isinstance(duration_us, int) or duration_us < 1:
        raise PredictionBundleError("association artifact.durationUs must be a positive integer")
    links: list[dict[str, Any]] = []
    for index, raw in enumerate(value["activeSpeakerLinks"]):
        if not isinstance(raw, dict) or set(raw) != {"speakerId", "range", "faceTrackId", "confidence", "reason"}:
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}] is malformed")
        interval = raw.get("range")
        if not isinstance(interval, dict) or set(interval) != {"startUs", "endUs"}:
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}].range is malformed")
        start_us, end_us = interval.get("startUs"), interval.get("endUs")
        if (isinstance(start_us, bool) or not isinstance(start_us, int) or start_us < 0
                or isinstance(end_us, bool) or not isinstance(end_us, int) or end_us <= start_us or end_us > duration_us):
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}] is outside source duration")
        reason = raw.get("reason")
        face = raw.get("faceTrackId")
        if reason not in {"audio_video_association", "offscreen", "insufficient_evidence"}:
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}].reason is invalid")
        if reason == "audio_video_association" and not isinstance(face, str):
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}] lacks an associated face")
        if reason != "audio_video_association" and face is not None:
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}] fallback claims a face")
        confidence = raw.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise PredictionBundleError(f"association artifact.activeSpeakerLinks[{index}].confidence is invalid")
        links.append({
            "speakerId": _require_string(raw.get("speakerId"), f"association artifact.activeSpeakerLinks[{index}].speakerId"),
            "startUs": start_us,
            "endUs": end_us,
            "faceTrackId": face,
            "confidence": float(confidence),
            "reason": reason,
        })
    return links


def _verify_measurement(value: Any) -> dict[str, float]:
    if not isinstance(value, dict) or value.get("scope") != "cgroup-v2":
        raise PredictionBundleError("candidate measurement must use cgroup-v2 scope for promotion evidence")
    required = ["peakRssBytes", "sustainedSwapBytes", "wallSeconds", "mediaSeconds", "coldStartSeconds"]
    return {field: _require_nonnegative_number(value.get(field), f"candidate measurement.{field}") for field in required}


def _write_once(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, (_canonical_json(value) + "\n").encode("utf-8"))
    finally:
        os.close(descriptor)


def build_prediction_bundle(
    *,
    mapping_path: Path,
    candidate_root: Path,
    models_manifest: Path,
    model_root: Path,
    corpus_version: str,
    manifest_sha256: str,
    object_index_sha256: str,
    evaluator_key_fingerprint: str,
    hardware_path: Path,
    association_code_path: Path,
) -> dict[str, Any]:
    """Build the unsigned HVE-G5 bundle that the existing Ed25519 tool signs."""
    mapping_bundle = _read_json(mapping_path, "evaluator mappings")
    if set(mapping_bundle) != {"schemaVersion", "kind", "items"} or mapping_bundle.get("schemaVersion") != 1 or mapping_bundle.get("kind") != "hve-active-speaker-evaluator-mappings-v1":
        raise PredictionBundleError("evaluator mappings have an unsupported schema")
    mappings = mapping_bundle.get("items")
    if not isinstance(mappings, list) or not mappings:
        raise PredictionBundleError("evaluator mappings must contain at least one item")
    hardware = _read_json(hardware_path, "hardware evidence")
    if set(hardware) != {"profile", "cpuCount", "memoryBytes"} or hardware.get("profile") != "timeweb-cpu8-12gb":
        raise PredictionBundleError("hardware evidence must describe timeweb-cpu8-12gb exactly")
    if isinstance(hardware.get("cpuCount"), bool) or not isinstance(hardware.get("cpuCount"), int) or hardware["cpuCount"] < 8:
        raise PredictionBundleError("hardware.cpuCount must record at least 8 CPUs")
    if isinstance(hardware.get("memoryBytes"), bool) or not isinstance(hardware.get("memoryBytes"), int) or hardware["memoryBytes"] < 12 * 1024 ** 3:
        raise PredictionBundleError("hardware.memoryBytes must record at least 12 GiB")
    models = verify_evaluator_models(manifest_path=models_manifest, model_root=model_root)
    association_code_hash = sha256(association_code_path.read_bytes()).hexdigest()
    seen_item_ids: set[str] = set()
    candidate_provenance: dict[str, str] | None = None
    items: list[dict[str, Any]] = []
    for index, mapping in enumerate(mappings):
        if not isinstance(mapping, dict) or set(mapping) != _MAPPING_KEYS:
            raise PredictionBundleError(f"evaluator mappings.items[{index}] is malformed")
        item_id = _require_string(mapping.get("itemId"), f"evaluator mappings.items[{index}].itemId")
        if item_id in seen_item_ids:
            raise PredictionBundleError(f"evaluator mappings contains duplicate {item_id}")
        seen_item_ids.add(item_id)
        output_dir = _safe_child(candidate_root, mapping.get("candidateOutput"), f"evaluator mappings.items[{index}].candidateOutput")
        artifact = _read_json(output_dir / "active-speaker-artifact.json", f"candidate association artifact for {item_id}")
        run = _read_json(output_dir / "candidate-run.json", f"candidate run for {item_id}")
        diarization_evidence = _read_json(output_dir / "diarization.json", f"candidate diarization evidence for {item_id}")
        mouth_evidence = _read_json(output_dir / "mouth-activity.json", f"candidate mouth evidence for {item_id}")
        if run.get("modelManifestFingerprint") != models.fingerprint:
            raise PredictionBundleError(f"candidate run for {item_id} does not bind the verified model manifest")
        if _require_hash(run.get("associationCodeSha256"), "candidate run.associationCodeSha256") != association_code_hash:
            raise PredictionBundleError(f"candidate run for {item_id} does not bind the association-code hash")
        if _sha256(diarization_evidence) != _require_hash(run.get("diarizationEvidenceSha256"), "candidate run.diarizationEvidenceSha256"):
            raise PredictionBundleError(f"candidate run for {item_id} does not bind diarization evidence bytes")
        if _sha256(mouth_evidence) != _require_hash(run.get("mouthEvidenceSha256"), "candidate run.mouthEvidenceSha256"):
            raise PredictionBundleError(f"candidate run for {item_id} does not bind mouth evidence bytes")
        links = _verify_artifact(artifact, run, mapping)
        provenance = artifact.get("provenance")
        if not isinstance(provenance, dict) or not isinstance(provenance.get("diarization"), dict) or not isinstance(provenance.get("mouthActivity"), dict):
            raise PredictionBundleError(f"candidate association artifact for {item_id} lacks provenance")
        diarization = provenance["diarization"]
        mouth = provenance["mouthActivity"]
        if _require_hash(diarization.get("artifactSha256"), "candidate diarization provenance.artifactSha256") != _sha256(diarization_evidence):
            raise PredictionBundleError(f"candidate association artifact for {item_id} does not bind diarization evidence")
        if _require_hash(mouth.get("artifactSha256"), "candidate mouth provenance.artifactSha256") != _sha256(mouth_evidence):
            raise PredictionBundleError(f"candidate association artifact for {item_id} does not bind mouth evidence")
        current_provenance = {
            "diarizationEngine": _require_string(diarization.get("engine"), "candidate diarization engine", minimum=2),
            "diarizationModelVersion": _require_string(diarization.get("modelVersion"), "candidate diarization model version", minimum=2),
            "mouthEngine": _require_string(mouth.get("engine"), "candidate mouth engine", minimum=2),
            "mouthModelVersion": _require_string(mouth.get("modelVersion"), "candidate mouth model version", minimum=2),
        }
        if candidate_provenance is None:
            candidate_provenance = current_provenance
        elif candidate_provenance != current_provenance:
            raise PredictionBundleError("all candidate outputs must use exactly one engine/model version set")
        items.append({
            "itemId": item_id,
            "sourceHash": _require_hash(mapping.get("sourceHash"), f"evaluator mappings.items[{index}].sourceHash"),
            "links": links,
            "evaluatorMappings": {
                "speakers": _require_mapping(mapping.get("speakers"), f"evaluator mappings.items[{index}].speakers"),
                "faces": _require_mapping(mapping.get("faces"), f"evaluator mappings.items[{index}].faces"),
            },
            "measurement": _verify_measurement(run.get("measurement")),
        })
    if candidate_provenance is None:
        raise PredictionBundleError("evaluator mappings did not yield candidate provenance")
    segmentation = models.require("sherpa_segmentation")
    embedding = models.require("sherpa_embedding")
    mouth_model = models.require("mediapipe_face_landmarker")
    return {
        "schemaVersion": 1,
        "kind": "hve-active-speaker-predictions-v1",
        "corpusVersion": _require_string(corpus_version, "corpus_version", minimum=3),
        "manifestSha256": _require_hash(manifest_sha256, "manifest_sha256"),
        "objectIndexSha256": _require_hash(object_index_sha256, "object_index_sha256"),
        "evaluatorKeyFingerprint": _require_hash(evaluator_key_fingerprint, "evaluator_key_fingerprint"),
        "candidate": {
            **candidate_provenance,
            # Diarization uses two immutable ONNX files. Hash their canonical
            # ordered pair so the benchmark identifies that exact model set.
            "diarizationModelSha256": _sha256({"segmentation": segmentation.sha256, "embedding": embedding.sha256}),
            "mouthModelSha256": mouth_model.sha256,
            "associationCodeSha256": association_code_hash,
        },
        "hardware": hardware,
        "items": items,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Assemble unsigned HVE-G5 active-speaker predictions from evaluator artifacts.")
    parser.add_argument("--mapping", required=True, type=Path)
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument("--models-manifest", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--corpus-version", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--object-index-sha256", required=True)
    parser.add_argument("--evaluator-key-fingerprint", required=True)
    parser.add_argument("--hardware", required=True, type=Path)
    parser.add_argument("--association-code", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    arguments = parser.parse_args()
    try:
        bundle = build_prediction_bundle(
            mapping_path=arguments.mapping,
            candidate_root=arguments.candidate_root,
            models_manifest=arguments.models_manifest,
            model_root=arguments.model_root,
            corpus_version=arguments.corpus_version,
            manifest_sha256=arguments.manifest_sha256,
            object_index_sha256=arguments.object_index_sha256,
            evaluator_key_fingerprint=arguments.evaluator_key_fingerprint,
            hardware_path=arguments.hardware,
            association_code_path=arguments.association_code,
        )
        _write_once(arguments.out, bundle)
    except (OSError, ValueError, ModelManifestError, PredictionBundleError) as error:
        parser.exit(2, f"HVE active-speaker prediction bundle rejected: {error}\n")
    print(json.dumps({"status": "assembled", "items": len(bundle["items"]), "output": str(arguments.out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
