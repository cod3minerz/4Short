"""Evidence-bound audio-to-face association for the HVE active-speaker path.

This module intentionally has no video, model or storage dependency.  A
diarizer supplies anonymous speaker turns and a landmark pass supplies bounded
mouth-activity windows for stable face tracks.  The scorer produces only
high-confidence associations; it prefers an explicit fallback over choosing
the largest visible face.

It is not wired into a worker stage until the diarization and landmark model
ADR has passed.  Keeping this pure lets both candidates share exactly the
same deterministic association/fallback policy and benchmark harness.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import itertools
import json
import re
from typing import Literal


AssociationReason = Literal["audio_video_association", "offscreen", "insufficient_evidence"]


@dataclass(frozen=True)
class SpeakerTurn:
    speaker_id: str
    start_ms: int
    end_ms: int
    confidence: float


@dataclass(frozen=True)
class MouthActivityWindow:
    face_track_id: str
    start_ms: int
    end_ms: int
    activity: float
    face_confidence: float


@dataclass(frozen=True)
class ActiveSpeakerAssociation:
    speaker_id: str
    start_ms: int
    end_ms: int
    face_track_id: str | None
    confidence: float
    reason: AssociationReason


def _has_conflicting_speaker(turn: SpeakerTurn, turns: list[SpeakerTurn]) -> bool:
    """Return whether another diarized person overlaps this exact turn.

    Simultaneous speech is common in panels and is precisely where simple
    mouth-motion matching becomes unreliable.  Do not turn a global mapping
    into a false per-turn identity claim: the caller gets a visible
    ``insufficient_evidence`` fallback for both sides of the overlap.
    """
    return any(
        other.speaker_id != turn.speaker_id
        and _overlap(turn.start_ms, turn.end_ms, other.start_ms, other.end_ms) > 0
        for other in turns
    )


def _overlap(start_ms: int, end_ms: int, other_start_ms: int, other_end_ms: int) -> int:
    return max(0, min(end_ms, other_end_ms) - max(start_ms, other_start_ms))


def _bounded(value: float) -> float:
    return min(1.0, max(0.0, value))


def _weighted_activity(
    windows: list[MouthActivityWindow],
    start_ms: int,
    end_ms: int,
) -> tuple[float, int, float]:
    """Return mean mouth motion, observed milliseconds and face confidence."""
    total_weight = 0
    activity_sum = 0.0
    confidence_sum = 0.0
    for window in windows:
        overlap = _overlap(start_ms, end_ms, window.start_ms, window.end_ms)
        if overlap <= 0:
            continue
        total_weight += overlap
        activity_sum += _bounded(window.activity) * overlap
        confidence_sum += _bounded(window.face_confidence) * overlap
    if total_weight == 0:
        return 0.0, 0, 0.0
    return activity_sum / total_weight, total_weight, confidence_sum / total_weight


def _speaker_score(
    speaker_turns: list[SpeakerTurn],
    windows: list[MouthActivityWindow],
    all_turns: list[SpeakerTurn],
) -> tuple[float, float, int]:
    """Score whether one face's mouth activity follows one anonymous speaker.

    The score is deliberately contrastive: a face that moves equally while all
    speakers talk is not enough to identify a person.  We require coverage and
    a positive in-turn versus out-of-turn motion gap before an association can
    be considered.
    """
    active_weight = 0
    active_sum = 0.0
    active_face_confidence = 0.0
    for turn in speaker_turns:
        activity, covered_ms, face_confidence = _weighted_activity(windows, turn.start_ms, turn.end_ms)
        if covered_ms:
            active_weight += covered_ms
            active_sum += activity * covered_ms
            active_face_confidence += face_confidence * covered_ms
    if active_weight == 0:
        return -1.0, 0.0, 0

    speaker_id = speaker_turns[0].speaker_id
    background_weight = 0
    background_sum = 0.0
    for turn in all_turns:
        if turn.speaker_id == speaker_id:
            continue
        activity, covered_ms, _ = _weighted_activity(windows, turn.start_ms, turn.end_ms)
        if covered_ms:
            background_weight += covered_ms
            background_sum += activity * covered_ms
    active = active_sum / active_weight
    background = background_sum / background_weight if background_weight else 0.0
    # Match only when the face reacts materially more during this speaker's
    # turns.  Blend face detector confidence into the score but never use it
    # to manufacture mouth-motion evidence.
    face_confidence = active_face_confidence / active_weight
    contrast = active - background
    return contrast * face_confidence, face_confidence, active_weight


def _best_one_to_one_mapping(scores: dict[tuple[str, str], float], speakers: list[str], faces: list[str]) -> dict[str, str]:
    """Find a deterministic one-to-one mapping for small HVE conversations.

    HVE's compositor supports at most four visible people. Exhaustive matching
    here is smaller, clearer and safer than a new numerical dependency; ties
    are resolved lexicographically so a rerun cannot flip identities.
    """
    if not speakers or not faces:
        return {}
    best_total = float("-inf")
    best_pairs: tuple[tuple[str, str], ...] | None = None
    maximum = min(len(speakers), len(faces))
    for speaker_subset in itertools.combinations(sorted(speakers), maximum):
        for face_permutation in itertools.permutations(sorted(faces), maximum):
            pairs = tuple(zip(speaker_subset, face_permutation, strict=True))
            total = sum(scores.get(pair, -1.0) for pair in pairs)
            if total > best_total or (total == best_total and (best_pairs is None or pairs < best_pairs)):
                best_total = total
                best_pairs = pairs
    return dict(best_pairs or ())


def associate_active_speakers(
    turns: list[SpeakerTurn],
    mouth_windows: list[MouthActivityWindow],
    *,
    face_analysis_complete: bool,
    minimum_turn_ms: int = 700,
    minimum_coverage_ratio: float = 0.65,
    minimum_face_confidence: float = 0.70,
    minimum_contrast: float = 0.10,
    minimum_margin: float = 0.06,
) -> list[ActiveSpeakerAssociation]:
    """Associate diarized turns to visible faces or emit an honest fallback.

    ``offscreen`` is only emitted when a completed face-analysis pass observed
    no face window for the entire turn.  Any partial visual evidence, short
    turn, weak diarization, ambiguous candidate or low detector confidence is
    deliberately ``insufficient_evidence`` rather than a false off-screen
    claim.  Callers must keep that fallback visible in the editor/director.
    """
    valid_turns = [
        turn for turn in turns
        if turn.end_ms > turn.start_ms
        and turn.confidence >= 0.70
        and not _has_conflicting_speaker(turn, turns)
    ]
    by_speaker: dict[str, list[SpeakerTurn]] = {}
    for turn in valid_turns:
        by_speaker.setdefault(turn.speaker_id, []).append(turn)
    by_face: dict[str, list[MouthActivityWindow]] = {}
    for window in mouth_windows:
        if window.end_ms > window.start_ms:
            by_face.setdefault(window.face_track_id, []).append(window)

    scores: dict[tuple[str, str], float] = {}
    score_details: dict[tuple[str, str], tuple[float, int]] = {}
    for speaker_id, speaker_turns in by_speaker.items():
        for face_id, windows in by_face.items():
            score, face_confidence, covered_ms = _speaker_score(speaker_turns, windows, valid_turns)
            scores[(speaker_id, face_id)] = score
            score_details[(speaker_id, face_id)] = (face_confidence, covered_ms)

    mapping = _best_one_to_one_mapping(scores, list(by_speaker), list(by_face))
    result: list[ActiveSpeakerAssociation] = []
    for turn in sorted(turns, key=lambda value: (value.start_ms, value.end_ms, value.speaker_id)):
        duration = turn.end_ms - turn.start_ms
        if duration <= 0 or turn.confidence < 0.70 or duration < minimum_turn_ms:
            result.append(ActiveSpeakerAssociation(turn.speaker_id, turn.start_ms, turn.end_ms, None, 0.0, "insufficient_evidence"))
            continue
        if _has_conflicting_speaker(turn, turns):
            result.append(ActiveSpeakerAssociation(turn.speaker_id, turn.start_ms, turn.end_ms, None, 0.0, "insufficient_evidence"))
            continue

        visible_windows = [
            window for window in mouth_windows
            if _overlap(turn.start_ms, turn.end_ms, window.start_ms, window.end_ms) > 0
        ]
        if not visible_windows:
            result.append(ActiveSpeakerAssociation(
                turn.speaker_id,
                turn.start_ms,
                turn.end_ms,
                None,
                round(_bounded(turn.confidence), 4),
                "offscreen" if face_analysis_complete else "insufficient_evidence",
            ))
            continue

        face_id = mapping.get(turn.speaker_id)
        if face_id is None:
            result.append(ActiveSpeakerAssociation(turn.speaker_id, turn.start_ms, turn.end_ms, None, 0.0, "insufficient_evidence"))
            continue
        face_windows = by_face[face_id]
        _, covered_ms, face_confidence = _weighted_activity(face_windows, turn.start_ms, turn.end_ms)
        score = scores.get((turn.speaker_id, face_id), -1.0)
        alternatives = sorted(
            (candidate for (speaker, candidate), candidate_score in scores.items() if speaker == turn.speaker_id and candidate != face_id),
            key=lambda candidate: scores[(turn.speaker_id, candidate)],
            reverse=True,
        )
        second_score = scores[(turn.speaker_id, alternatives[0])] if alternatives else 0.0
        coverage_ratio = covered_ms / duration
        margin = score - second_score
        if (
            coverage_ratio < minimum_coverage_ratio
            or face_confidence < minimum_face_confidence
            or score < minimum_contrast
            or margin < minimum_margin
        ):
            result.append(ActiveSpeakerAssociation(turn.speaker_id, turn.start_ms, turn.end_ms, None, 0.0, "insufficient_evidence"))
            continue
        confidence = _bounded(0.45 * turn.confidence + 0.25 * face_confidence + 0.2 * coverage_ratio + 0.1 * min(1.0, margin / 0.25))
        result.append(ActiveSpeakerAssociation(turn.speaker_id, turn.start_ms, turn.end_ms, face_id, round(confidence, 4), "audio_video_association"))
    return result


def build_active_speaker_artifact(
    *,
    analysis_id: str,
    source_id: str,
    source_hash: str,
    engine_version: str,
    duration_ms: int,
    speaker_turns: list[SpeakerTurn],
    mouth_windows: list[MouthActivityWindow],
    face_analysis_complete: bool,
    diarization_engine: str,
    diarization_model_version: str,
    diarization_artifact_sha256: str,
    mouth_engine: str,
    mouth_model_version: str,
    mouth_artifact_sha256: str,
    warnings: list[dict] | None = None,
) -> dict:
    """Build the compact, immutable HVE-5 association artifact.

    This function is deliberately independent from Sherpa/MediaPipe.  Those
    optional evaluation adapters must first emit bounded turns/windows; this
    boundary then applies the same deterministic association policy for every
    candidate.  It gives the control plane a verifiable artifact format while
    ensuring a missing model can never be mistaken for active-speaker output.
    """
    if not re.fullmatch(r"[0-9a-fA-F]{64}", source_hash):
        raise ValueError("source_hash must be a SHA-256 hex digest")
    if duration_ms <= 0:
        raise ValueError("duration_ms must be positive")
    for name, value in {
        "diarization_artifact_sha256": diarization_artifact_sha256,
        "mouth_artifact_sha256": mouth_artifact_sha256,
    }.items():
        if not re.fullmatch(r"[0-9a-fA-F]{64}", value):
            raise ValueError(f"{name} must be a SHA-256 hex digest")
    links = associate_active_speakers(
        speaker_turns,
        mouth_windows,
        face_analysis_complete=face_analysis_complete,
    )
    duration_us = duration_ms * 1_000
    payload = {
        "schemaVersion": 1,
        "analysisId": analysis_id,
        "sourceId": source_id,
        "sourceHash": source_hash.lower(),
        "engineVersion": engine_version,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "durationUs": duration_us,
        "faceAnalysisComplete": face_analysis_complete,
        "speakerTurns": [{
            "speakerId": turn.speaker_id,
            "range": {"startUs": turn.start_ms * 1_000, "endUs": turn.end_ms * 1_000},
            "confidence": round(_bounded(turn.confidence), 4),
        } for turn in speaker_turns],
        "mouthActivity": [{
            "faceTrackId": window.face_track_id,
            "range": {"startUs": window.start_ms * 1_000, "endUs": window.end_ms * 1_000},
            "activity": round(_bounded(window.activity), 4),
            "faceConfidence": round(_bounded(window.face_confidence), 4),
        } for window in mouth_windows],
        "activeSpeakerLinks": [{
            "speakerId": link.speaker_id,
            "range": {"startUs": link.start_ms * 1_000, "endUs": link.end_ms * 1_000},
            "faceTrackId": link.face_track_id,
            "confidence": link.confidence,
            "reason": link.reason,
        } for link in links],
        "provenance": {
            "diarization": {
                "engine": diarization_engine,
                "modelVersion": diarization_model_version,
                "artifactSha256": diarization_artifact_sha256.lower(),
            },
            "mouthActivity": {
                "engine": mouth_engine,
                "modelVersion": mouth_model_version,
                "artifactSha256": mouth_artifact_sha256.lower(),
            },
        },
        "warnings": list(warnings or []),
    }
    # The function constructs this fixed compact shape itself — no decoded
    # frame, landmark vector, embedding or audio payload is accepted as an
    # input. The TypeScript contract re-validates it before it becomes an
    # analysis artifact in the control plane.
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    payload["artifactHash"] = sha256(serialized.encode("utf-8")).hexdigest()
    return payload
