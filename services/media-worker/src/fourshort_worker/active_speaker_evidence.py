"""Strict, file-based boundary for HVE active-speaker candidate evidence.

The production worker must not silently turn arbitrary model output into an
``active speaker`` claim.  Candidate diarization and mouth-motion adapters
therefore export two deliberately small JSON documents.  This module validates
that they describe the same immutable source, rejects raw media/model payloads
and applies the shared conservative association policy from ``association``.

It is an evaluator boundary, *not* a worker stage.  No public UI or automatic
layout route may consume its output until HVE-G5 has accepted signed corpus and
target-worker evidence.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any

from .association import MouthActivityWindow, SpeakerTurn, build_active_speaker_artifact


class EvidenceValidationError(ValueError):
    """Raised when a candidate tries to cross the immutable HVE boundary."""


_SHA256 = re.compile(r"[0-9a-fA-F]{64}")
_TOP_LEVEL = {"schemaVersion", "sourceHash", "durationMs", "engine", "modelVersion", "turns"}
_MOUTH_TOP_LEVEL = _TOP_LEVEL - {"turns"} | {"faceAnalysisComplete", "windows"}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def evidence_sha256(value: dict[str, Any]) -> str:
    """Hash exactly the bounded evidence object used for an HVE artifact."""
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceValidationError(f"{label} must be an object")
    return value


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unknown = sorted(actual - expected)
        detail = []
        if missing:
            detail.append(f"missing {', '.join(missing)}")
        if unknown:
            detail.append(f"unknown {', '.join(unknown)}")
        raise EvidenceValidationError(f"{label} has invalid fields ({'; '.join(detail)})")


def _require_string(value: Any, label: str, minimum_length: int = 1) -> str:
    if not isinstance(value, str) or len(value.strip()) < minimum_length:
        raise EvidenceValidationError(f"{label} must be a non-empty string")
    return value.strip()


def _require_integer(value: Any, label: str, *, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise EvidenceValidationError(f"{label} must be an integer")
    if minimum is not None and value < minimum:
        raise EvidenceValidationError(f"{label} must be at least {minimum}")
    return value


def _require_probability(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EvidenceValidationError(f"{label} must be a number from 0 to 1")
    numeric = float(value)
    if not 0 <= numeric <= 1:
        raise EvidenceValidationError(f"{label} must be a number from 0 to 1")
    return numeric


def _validate_shared_metadata(value: dict[str, Any], *, expected: set[str], label: str) -> tuple[str, int, str, str]:
    _require_exact_keys(value, expected, label)
    if value.get("schemaVersion") != 1:
        raise EvidenceValidationError(f"{label}.schemaVersion must equal 1")
    source_hash = _require_string(value.get("sourceHash"), f"{label}.sourceHash", 64)
    if not _SHA256.fullmatch(source_hash):
        raise EvidenceValidationError(f"{label}.sourceHash must be a SHA-256 hex digest")
    duration_ms = _require_integer(value.get("durationMs"), f"{label}.durationMs", minimum=1)
    engine = _require_string(value.get("engine"), f"{label}.engine", 2)
    model_version = _require_string(value.get("modelVersion"), f"{label}.modelVersion", 1)
    return source_hash.lower(), duration_ms, engine, model_version


def parse_diarization_evidence(value: Any) -> tuple[str, int, str, str, list[SpeakerTurn]]:
    """Parse bounded diarization evidence without accepting embeddings/audio."""
    document = _require_object(value, "diarization evidence")
    source_hash, duration_ms, engine, model_version = _validate_shared_metadata(
        document,
        expected=_TOP_LEVEL,
        label="diarization evidence",
    )
    turns_value = document["turns"]
    if not isinstance(turns_value, list) or len(turns_value) > 100_000:
        raise EvidenceValidationError("diarization evidence.turns must be an array up to 100000 items")
    turns: list[SpeakerTurn] = []
    for index, raw in enumerate(turns_value):
        item = _require_object(raw, f"diarization evidence.turns[{index}]")
        _require_exact_keys(item, {"speakerId", "startMs", "endMs", "confidence"}, f"diarization evidence.turns[{index}]")
        start_ms = _require_integer(item["startMs"], f"diarization evidence.turns[{index}].startMs", minimum=0)
        end_ms = _require_integer(item["endMs"], f"diarization evidence.turns[{index}].endMs", minimum=1)
        if end_ms <= start_ms or end_ms > duration_ms:
            raise EvidenceValidationError(f"diarization evidence.turns[{index}] is outside the source duration")
        turns.append(SpeakerTurn(
            _require_string(item["speakerId"], f"diarization evidence.turns[{index}].speakerId"),
            start_ms,
            end_ms,
            _require_probability(item["confidence"], f"diarization evidence.turns[{index}].confidence"),
        ))
    return source_hash, duration_ms, engine, model_version, turns


def parse_mouth_activity_evidence(value: Any) -> tuple[str, int, str, str, bool, list[MouthActivityWindow]]:
    """Parse only compact motion windows, never frames or landmark vectors."""
    document = _require_object(value, "mouth evidence")
    source_hash, duration_ms, engine, model_version = _validate_shared_metadata(
        document,
        expected=_MOUTH_TOP_LEVEL,
        label="mouth evidence",
    )
    complete = document.get("faceAnalysisComplete")
    if not isinstance(complete, bool):
        raise EvidenceValidationError("mouth evidence.faceAnalysisComplete must be boolean")
    windows_value = document["windows"]
    if not isinstance(windows_value, list) or len(windows_value) > 100_000:
        raise EvidenceValidationError("mouth evidence.windows must be an array up to 100000 items")
    windows: list[MouthActivityWindow] = []
    for index, raw in enumerate(windows_value):
        item = _require_object(raw, f"mouth evidence.windows[{index}]")
        _require_exact_keys(item, {"faceTrackId", "startMs", "endMs", "activity", "faceConfidence"}, f"mouth evidence.windows[{index}]")
        start_ms = _require_integer(item["startMs"], f"mouth evidence.windows[{index}].startMs", minimum=0)
        end_ms = _require_integer(item["endMs"], f"mouth evidence.windows[{index}].endMs", minimum=1)
        if end_ms <= start_ms or end_ms > duration_ms:
            raise EvidenceValidationError(f"mouth evidence.windows[{index}] is outside the source duration")
        windows.append(MouthActivityWindow(
            _require_string(item["faceTrackId"], f"mouth evidence.windows[{index}].faceTrackId"),
            start_ms,
            end_ms,
            _require_probability(item["activity"], f"mouth evidence.windows[{index}].activity"),
            _require_probability(item["faceConfidence"], f"mouth evidence.windows[{index}].faceConfidence"),
        ))
    return source_hash, duration_ms, engine, model_version, complete, windows


def compile_active_speaker_evidence(
    *,
    analysis_id: str,
    source_id: str,
    engine_version: str,
    diarization_evidence: Any,
    mouth_evidence: Any,
    warnings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create an immutable active-speaker artifact from two candidate outputs.

    The method cross-checks source hash/duration before one algorithm can be
    paired with evidence belonging to another file.  Raw provider documents
    are deliberately referenced through hashes only in the returned artifact.
    """
    source_hash, duration_ms, diarization_engine, diarization_model, turns = parse_diarization_evidence(diarization_evidence)
    mouth_hash, mouth_duration_ms, mouth_engine, mouth_model, complete, windows = parse_mouth_activity_evidence(mouth_evidence)
    if mouth_hash != source_hash:
        raise EvidenceValidationError("diarization and mouth evidence must have the same sourceHash")
    if mouth_duration_ms != duration_ms:
        raise EvidenceValidationError("diarization and mouth evidence must have the same durationMs")
    return build_active_speaker_artifact(
        analysis_id=analysis_id,
        source_id=source_id,
        source_hash=source_hash,
        engine_version=engine_version,
        duration_ms=duration_ms,
        speaker_turns=turns,
        mouth_windows=windows,
        face_analysis_complete=complete,
        diarization_engine=diarization_engine,
        diarization_model_version=diarization_model,
        diarization_artifact_sha256=evidence_sha256(_require_object(diarization_evidence, "diarization evidence")),
        mouth_engine=mouth_engine,
        mouth_model_version=mouth_model,
        mouth_artifact_sha256=evidence_sha256(_require_object(mouth_evidence, "mouth evidence")),
        warnings=warnings,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile bounded HVE active-speaker evaluator evidence.")
    parser.add_argument("--diarization", required=True, type=Path)
    parser.add_argument("--mouth-activity", required=True, type=Path)
    parser.add_argument("--analysis-id", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--engine-version", default="hve-active-speaker-evaluator-v1")
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    try:
        diarization = json.loads(arguments.diarization.read_text("utf-8"))
        mouth_activity = json.loads(arguments.mouth_activity.read_text("utf-8"))
        artifact = compile_active_speaker_evidence(
            analysis_id=arguments.analysis_id,
            source_id=arguments.source_id,
            engine_version=arguments.engine_version,
            diarization_evidence=diarization,
            mouth_evidence=mouth_activity,
        )
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(_canonical_json(artifact) + "\n", encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.exit(2, f"HVE active-speaker evidence rejected: {error}\n")


if __name__ == "__main__":
    main()
