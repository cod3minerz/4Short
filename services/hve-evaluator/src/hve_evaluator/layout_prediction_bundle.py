"""Build a signed-input-ready HVE-G6 prediction bundle from candidate runs.

Only the evaluator runs this module. It validates the private candidate
artifacts before deriving prediction decisions, then leaves semantic mapping
of opaque candidate IDs to independent evaluators. The product and the media
worker never receive the mapping, candidate evidence or output path.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from typing import Any


class LayoutPredictionBundleError(ValueError):
    """Raised for any unbound/malformed HVE-G6 candidate evidence."""


_HASH = re.compile(r"^[0-9a-f]{64}$")
_ITEM_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$")


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _sha256(value: Any) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise LayoutPredictionBundleError(f"cannot read {label}") from error
    if not isinstance(value, dict):
        raise LayoutPredictionBundleError(f"{label} must be an object")
    return value


def _require_string(value: Any, label: str, minimum: int = 1) -> str:
    if not isinstance(value, str) or len(value.strip()) < minimum:
        raise LayoutPredictionBundleError(f"{label} must be a non-empty string")
    return value.strip()


def _require_hash(value: Any, label: str) -> str:
    value = _require_string(value, label, 64).lower()
    if not _HASH.fullmatch(value):
        raise LayoutPredictionBundleError(f"{label} must be a SHA-256 digest")
    return value


def _positive_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise LayoutPredictionBundleError(f"{label} must be a positive integer")
    return value


def _safe_item_file(root: Path, item_id: str) -> Path:
    if not _ITEM_ID.fullmatch(item_id):
        raise LayoutPredictionBundleError("mapping itemId is unsafe")
    resolved_root = root.resolve()
    candidate = (resolved_root / item_id / "layout-candidate.json").resolve()
    if resolved_root not in candidate.parents:
        raise LayoutPredictionBundleError("candidate artifact path escapes candidate root")
    return candidate


def _candidate_artifact(path: Path, item_id: str) -> dict[str, Any]:
    artifact = _read_json(path, f"layout candidate artifact for {item_id}")
    required = {
        "schemaVersion", "kind", "sourceHash", "durationMs", "candidate", "regions", "segments", "measurement", "artifactSha256",
    }
    if set(artifact) != required or artifact.get("schemaVersion") != 1 or artifact.get("kind") != "hve-layout-candidate-run-v1":
        raise LayoutPredictionBundleError(f"candidate artifact for {item_id} has an unsupported shape")
    actual_hash = artifact.pop("artifactSha256")
    try:
        calculated_hash = _sha256(artifact)
    finally:
        artifact["artifactSha256"] = actual_hash
    if _require_hash(actual_hash, f"candidate artifact {item_id}.artifactSha256") != calculated_hash:
        raise LayoutPredictionBundleError(f"candidate artifact for {item_id} was changed after hashing")
    _require_hash(artifact.get("sourceHash"), f"candidate artifact {item_id}.sourceHash")
    _positive_int(artifact.get("durationMs"), f"candidate artifact {item_id}.durationMs")
    candidate = artifact.get("candidate")
    required_candidate = {
        "regionDetector", "regionModelVersion", "regionModelSha256",
        "faceDetector", "faceModelVersion", "faceModelSha256",
        "directorVersion", "directorCodeSha256",
    }
    if not isinstance(candidate, dict) or set(candidate) != required_candidate:
        raise LayoutPredictionBundleError(f"candidate artifact {item_id}.candidate is malformed")
    for field in ["regionDetector", "regionModelVersion", "faceDetector", "faceModelVersion", "directorVersion"]:
        _require_string(candidate.get(field), f"candidate artifact {item_id}.candidate.{field}", 2)
    for field in ["regionModelSha256", "faceModelSha256", "directorCodeSha256"]:
        _require_hash(candidate.get(field), f"candidate artifact {item_id}.candidate.{field}")
    if not isinstance(artifact.get("regions"), list) or not isinstance(artifact.get("segments"), list):
        raise LayoutPredictionBundleError(f"candidate artifact {item_id} regions/segments are malformed")
    region_ids: set[str] = set()
    for index, region in enumerate(artifact["regions"]):
        if not isinstance(region, dict) or set(region) != {"regionId", "kind", "range", "box", "observations", "confidence"}:
            raise LayoutPredictionBundleError(f"candidate artifact {item_id}.regions[{index}] is malformed")
        region_id = _require_string(region.get("regionId"), f"candidate artifact {item_id}.regions[{index}].regionId")
        if region_id in region_ids:
            raise LayoutPredictionBundleError(f"candidate artifact {item_id} duplicates a region ID")
        region_ids.add(region_id)
    previous_end = 0
    for index, segment in enumerate(artifact["segments"]):
        if not isinstance(segment, dict) or set(segment) != {"startMs", "endMs", "template", "regionIds", "transitionLatencyMs"}:
            raise LayoutPredictionBundleError(f"candidate artifact {item_id}.segments[{index}] is malformed")
        start_ms, end_ms = segment.get("startMs"), segment.get("endMs")
        if not isinstance(start_ms, int) or not isinstance(end_ms, int) or start_ms < previous_end or end_ms <= start_ms or end_ms > artifact["durationMs"]:
            raise LayoutPredictionBundleError(f"candidate artifact {item_id}.segments[{index}] has invalid time range")
        previous_end = end_ms
        _require_string(segment.get("template"), f"candidate artifact {item_id}.segments[{index}].template")
        if not isinstance(segment.get("regionIds"), list) or any(region_id not in region_ids for region_id in segment["regionIds"]):
            raise LayoutPredictionBundleError(f"candidate artifact {item_id}.segments[{index}] references an unknown region")
    measurement = artifact.get("measurement")
    required_measurement = {"scope", "peakRssBytes", "sustainedSwapBytes", "wallSeconds", "mediaSeconds", "coldStartSeconds"}
    if not isinstance(measurement, dict) or set(measurement) != required_measurement or measurement.get("scope") != "cgroup-v2":
        raise LayoutPredictionBundleError(f"candidate artifact {item_id} requires cgroup-v2 measurement")
    for field in required_measurement - {"scope"}:
        if not isinstance(measurement[field], (int, float)) or isinstance(measurement[field], bool) or measurement[field] < 0:
            raise LayoutPredictionBundleError(f"candidate artifact {item_id}.measurement.{field} is invalid")
    return artifact


def _mapping(value: dict[str, Any]) -> list[dict[str, Any]]:
    if set(value) != {"schemaVersion", "kind", "items"} or value.get("schemaVersion") != 1 or value.get("kind") != "hve-layout-director-evaluator-mapping-v1" or not isinstance(value.get("items"), list):
        raise LayoutPredictionBundleError("layout evaluator mapping has an unsupported shape")
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(value["items"]):
        if not isinstance(item, dict) or set(item) != {"itemId", "sourceHash", "candidateArtifactSha256", "regions", "ranges"}:
            raise LayoutPredictionBundleError(f"mapping.items[{index}] has an unsupported shape")
        item_id = _require_string(item.get("itemId"), f"mapping.items[{index}].itemId", 2)
        if item_id in seen or not _ITEM_ID.fullmatch(item_id):
            raise LayoutPredictionBundleError(f"mapping.items[{index}].itemId is duplicate or unsafe")
        seen.add(item_id)
        _require_hash(item.get("sourceHash"), f"mapping.items[{index}].sourceHash")
        _require_hash(item.get("candidateArtifactSha256"), f"mapping.items[{index}].candidateArtifactSha256")
        if not isinstance(item.get("regions"), dict) or any(not isinstance(key, str) or not isinstance(value, str) or not key or not value for key, value in item["regions"].items()):
            raise LayoutPredictionBundleError(f"mapping.items[{index}].regions is malformed")
        if not isinstance(item.get("ranges"), list) or not item["ranges"]:
            raise LayoutPredictionBundleError(f"mapping.items[{index}].ranges is malformed")
        range_ids: set[str] = set()
        for range_index, range_value in enumerate(item["ranges"]):
            if not isinstance(range_value, dict) or set(range_value) != {"rangeId", "startUs", "endUs"}:
                raise LayoutPredictionBundleError(f"mapping.items[{index}].ranges[{range_index}] is malformed")
            range_id = _require_string(range_value.get("rangeId"), f"mapping.items[{index}].ranges[{range_index}].rangeId")
            start_us, end_us = range_value.get("startUs"), range_value.get("endUs")
            if range_id in range_ids or not isinstance(start_us, int) or not isinstance(end_us, int) or start_us < 0 or end_us <= start_us:
                raise LayoutPredictionBundleError(f"mapping.items[{index}].ranges[{range_index}] is invalid")
            range_ids.add(range_id)
        items.append(item)
    if not items:
        raise LayoutPredictionBundleError("layout evaluator mapping has no items")
    return items


def _decision_for_range(artifact: dict[str, Any], *, range_id: str, start_us: int, end_us: int) -> dict[str, Any]:
    start_ms, end_ms = start_us // 1_000, (end_us + 999) // 1_000
    candidates: list[tuple[int, int, dict[str, Any]]] = []
    for index, segment in enumerate(artifact["segments"]):
        overlap = max(0, min(end_ms, segment["endMs"]) - max(start_ms, segment["startMs"]))
        if overlap:
            candidates.append((overlap, -index, segment))
    if not candidates:
        return {
            "rangeId": range_id,
            "range": {"startUs": start_us, "endUs": end_us},
            "template": "portrait_focus",
            "transitionLatencyMs": 0,
            "regions": [],
        }
    _, _, selected = max(candidates, key=lambda item: (item[0], item[1]))
    return {
        "rangeId": range_id,
        "range": {"startUs": start_us, "endUs": end_us},
        "template": selected["template"],
        "transitionLatencyMs": selected["transitionLatencyMs"],
        # Candidate slots preserve their selected input regions completely.
        # The independent scorer checks these IDs against semantic ground
        # truth; a missing mapping remains a miss rather than a silent match.
        "regions": [{"regionId": region_id, "visibleAreaRatio": 1.0} for region_id in selected["regionIds"]],
    }


def build_layout_prediction_bundle(
    *,
    mapping_path: Path,
    candidate_root: Path,
    corpus_version: str,
    manifest_sha256: str,
    object_index_sha256: str,
    evaluator_key_fingerprint: str,
    hardware_path: Path,
) -> dict[str, Any]:
    """Bind verified G6 candidate artifacts to evaluator range mappings."""
    mappings = _mapping(_read_json(mapping_path, "layout evaluator mapping"))
    hardware = _read_json(hardware_path, "hardware profile")
    if set(hardware) != {"profile", "cpuCount", "memoryBytes"} or hardware.get("profile") != "timeweb-cpu8-12gb":
        raise LayoutPredictionBundleError("hardware profile must be exact Timeweb CPU8/12GB")
    if _positive_int(hardware.get("cpuCount"), "hardware.cpuCount") < 8 or _positive_int(hardware.get("memoryBytes"), "hardware.memoryBytes") < 12 * 1024 ** 3:
        raise LayoutPredictionBundleError("hardware profile is below Timeweb CPU8/12GB")
    output: list[dict[str, Any]] = []
    candidate_provenance: dict[str, str] | None = None
    for mapping in mappings:
        item_id = mapping["itemId"]
        artifact = _candidate_artifact(_safe_item_file(candidate_root, item_id), item_id)
        if artifact["sourceHash"] != _require_hash(mapping["sourceHash"], f"mapping {item_id}.sourceHash"):
            raise LayoutPredictionBundleError(f"mapping {item_id} source hash does not bind candidate artifact")
        if artifact["artifactSha256"] != _require_hash(mapping["candidateArtifactSha256"], f"mapping {item_id}.candidateArtifactSha256"):
            raise LayoutPredictionBundleError(f"mapping {item_id} artifact hash does not bind candidate artifact")
        artifact_ids = {region["regionId"] for region in artifact["regions"]}
        if any(candidate_id not in artifact_ids for candidate_id in mapping["regions"]):
            raise LayoutPredictionBundleError(f"mapping {item_id} maps a region absent from candidate artifact")
        if candidate_provenance is None:
            candidate_provenance = artifact["candidate"]
        elif candidate_provenance != artifact["candidate"]:
            raise LayoutPredictionBundleError("all layout candidate artifacts must have identical detector/director provenance")
        output.append({
            "itemId": item_id,
            "sourceHash": artifact["sourceHash"],
            "evaluatorMappings": {"regions": mapping["regions"]},
            "decisions": [
                _decision_for_range(artifact, range_id=entry["rangeId"], start_us=entry["startUs"], end_us=entry["endUs"])
                for entry in mapping["ranges"]
            ],
            "measurement": {key: artifact["measurement"][key] for key in ["peakRssBytes", "sustainedSwapBytes", "wallSeconds", "mediaSeconds", "coldStartSeconds"]},
        })
    if candidate_provenance is None:
        raise LayoutPredictionBundleError("layout evaluator mapping yielded no candidate provenance")
    return {
        "schemaVersion": 1,
        "kind": "hve-layout-director-predictions-v1",
        "corpusVersion": _require_string(corpus_version, "corpus_version", 3),
        "manifestSha256": _require_hash(manifest_sha256, "manifest_sha256"),
        "objectIndexSha256": _require_hash(object_index_sha256, "object_index_sha256"),
        "evaluatorKeyFingerprint": _require_hash(evaluator_key_fingerprint, "evaluator_key_fingerprint"),
        "candidate": candidate_provenance,
        "hardware": hardware,
        "items": output,
    }


def _write_once(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, (_canonical_json(value) + "\n").encode("utf-8"))
    finally:
        os.close(descriptor)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build unsigned evaluator-owned HVE-G6 prediction bundle.")
    parser.add_argument("--mapping", required=True, type=Path)
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument("--corpus-version", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--object-index-sha256", required=True)
    parser.add_argument("--evaluator-key-fingerprint", required=True)
    parser.add_argument("--hardware", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    arguments = parser.parse_args()
    try:
        bundle = build_layout_prediction_bundle(
            mapping_path=arguments.mapping,
            candidate_root=arguments.candidate_root,
            corpus_version=arguments.corpus_version,
            manifest_sha256=arguments.manifest_sha256,
            object_index_sha256=arguments.object_index_sha256,
            evaluator_key_fingerprint=arguments.evaluator_key_fingerprint,
            hardware_path=arguments.hardware,
        )
        _write_once(arguments.out, bundle)
    except (OSError, LayoutPredictionBundleError) as error:
        parser.exit(2, f"HVE layout prediction bundle rejected: {error}\n")
    print(json.dumps({"status": "assembled", "items": len(bundle["items"]), "output": str(arguments.out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
