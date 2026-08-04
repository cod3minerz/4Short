"""Evaluator-only baseline for HVE-G6 screen, gameplay and panel direction.

This is intentionally a conservative *candidate*, not a media-worker stage and
not a product layout selector.  It combines a versioned MediaPipe face model
with explainable OpenCV rectangle/edge evidence on sparse proxy frames.  The
result never stores source frames or landmarks: it records only normalized
boxes, compact temporal segments, model/code provenance and cgroup metrics.

The independent HVE-G6 evaluator maps the opaque candidate IDs to sealed
semantic labels and scores the result.  Thus neither a detector nor this
baseline can self-certify that a rectangle is a screen or that a facecam
belongs to gameplay.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from hashlib import sha256
import json
import math
import os
from pathlib import Path
from typing import Any

from .active_speaker_candidate import _file_sha256, _measurement, _write_once
from .model_manifest import ModelManifestError, VerifiedEvaluatorModelSet, verify_evaluator_models


class LayoutCandidateRuntimeError(RuntimeError):
    """Raised when an evaluator candidate cannot safely produce evidence."""


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.width / 2, self.y + self.height / 2

    def as_dict(self) -> dict[str, float]:
        return {
            "x": round(self.x, 6),
            "y": round(self.y, 6),
            "width": round(self.width, 6),
            "height": round(self.height, 6),
        }


@dataclass
class _Track:
    region_id: str
    kind: str
    box: Box
    first_ms: int
    last_ms: int
    observations: int = 1
    confidence_sum: float = 0.0
    missed: int = 0

    def observe(self, box: Box, at_ms: int, confidence: float) -> None:
        self.box = box
        self.last_ms = at_ms
        self.observations += 1
        self.confidence_sum += confidence
        self.missed = 0

    @property
    def confidence(self) -> float:
        return self.confidence_sum / max(1, self.observations)


def _clip_box(x: float, y: float, width: float, height: float) -> Box | None:
    x = min(1.0, max(0.0, x))
    y = min(1.0, max(0.0, y))
    width = min(1.0 - x, max(0.0, width))
    height = min(1.0 - y, max(0.0, height))
    if width < 0.02 or height < 0.02:
        return None
    return Box(x=x, y=y, width=width, height=height)


def _iou(left: Box, right: Box) -> float:
    x1, y1 = max(left.x, right.x), max(left.y, right.y)
    x2, y2 = min(left.x + left.width, right.x + right.width), min(left.y + left.height, right.y + right.height)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = left.area + right.area - intersection
    return intersection / union if union > 0 else 0.0


def _track_boxes(
    tracks: list[_Track],
    archived_tracks: list[_Track],
    detections: list[tuple[Box, float]],
    *,
    kind: str,
    prefix: str,
    at_ms: int,
    next_id: int,
    minimum_iou: float,
) -> tuple[list[_Track], int]:
    """Associate opaque candidate boxes deterministically.

    We only need stable candidate identity across sparse samples.  No track is
    extrapolated into an unobserved gap, and expired tracks are not revived;
    evaluation sees precisely what the candidate observed.
    """
    relevant = [track for track in tracks if track.kind == kind and track.missed <= 2]
    pairs: list[tuple[float, int, int]] = []
    for track_index, track in enumerate(relevant):
        for detection_index, (box, _) in enumerate(detections):
            score = _iou(track.box, box)
            if score >= minimum_iou:
                pairs.append((score, track_index, detection_index))
    claimed_tracks: set[int] = set()
    claimed_detections: set[int] = set()
    assigned: list[_Track | None] = [None] * len(detections)
    for _, track_index, detection_index in sorted(pairs, key=lambda item: (-item[0], item[1], item[2])):
        if track_index in claimed_tracks or detection_index in claimed_detections:
            continue
        track = relevant[track_index]
        box, confidence = detections[detection_index]
        track.observe(box, at_ms, confidence)
        claimed_tracks.add(track_index)
        claimed_detections.add(detection_index)
        assigned[detection_index] = track
    claimed_ids = {id(relevant[index]) for index in claimed_tracks}
    for track in tracks:
        if track.kind == kind and id(track) not in claimed_ids:
            track.missed += 1
    for detection_index, (box, confidence) in enumerate(detections):
        if assigned[detection_index] is not None:
            continue
        track = _Track(
            region_id=f"{prefix}-{next_id:03d}", kind=kind, box=box,
            first_ms=at_ms, last_ms=at_ms, confidence_sum=confidence,
        )
        tracks.append(track)
        assigned[detection_index] = track
        next_id += 1
    # Keep finished tracks in the compact artifact so a later labelled range
    # can still map a candidate ID even after that region leaves the frame.
    # They are removed only from live association to keep memory bounded.
    expired = [track for track in tracks if track.kind == kind and track.missed > 2]
    archived_tracks.extend(expired)
    tracks[:] = [track for track in tracks if not (track.kind == kind and track.missed > 2)]
    return [track for track in assigned if track is not None], next_id


def _face_boxes(landmark_sets: Any) -> list[tuple[Box, float]]:
    output: list[tuple[Box, float]] = []
    for landmarks in landmark_sets:
        if len(landmarks) <= 152:
            continue
        xs = [float(point.x) for point in landmarks]
        ys = [float(point.y) for point in landmarks]
        box = _clip_box(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
        if box is not None:
            # FaceLandmarker has no calibrated per-face score. This is the
            # configured admission threshold, not invented confidence.
            output.append((box, 0.70))
    return output


def _structural_boxes(frame: Any) -> list[tuple[Box, float]]:
    """Find large bounded rectangular regions without assigning semantics.

    The function deliberately returns *candidates*, not a claim that the
    rectangle is gameplay, a slide, a browser or even important content.  It
    is useful as a cheap baseline because common screen+facecam sources have a
    persistent bordered internal region.  The evaluator decides whether such
    candidates correspond to sealed labels.
    """
    try:
        import cv2
    except ImportError as error:  # pragma: no cover - exercised in image CI
        raise LayoutCandidateRuntimeError("OpenCV is unavailable in this evaluator image") from error
    height, width = frame.shape[:2]
    if width < 32 or height < 32:
        return []
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[Box, float]] = []
    frame_area = width * height
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(polygon) < 4 or len(polygon) > 8:
            continue
        x, y, rect_width, rect_height = cv2.boundingRect(polygon)
        area_ratio = (rect_width * rect_height) / frame_area
        if not 0.12 <= area_ratio <= 0.94:
            continue
        box = _clip_box(x / width, y / height, rect_width / width, rect_height / height)
        if box is None:
            continue
        # A compactness score avoids promoting a random noisy contour merely
        # because its bounding rectangle is large.
        contour_area = max(0.0, float(cv2.contourArea(contour)))
        compactness = min(1.0, contour_area / max(1.0, rect_width * rect_height))
        confidence = min(0.90, max(0.30, 0.55 * area_ratio + 0.45 * compactness))
        candidates.append((box, confidence))
    # Deterministic NMS: a nested rectangle rarely adds useful evidence and
    # makes later evaluator mappings unnecessarily ambiguous.
    output: list[tuple[Box, float]] = []
    for box, confidence in sorted(candidates, key=lambda item: (-item[1], -item[0].area, item[0].x, item[0].y)):
        if any(_iou(box, existing) >= 0.78 for existing, _ in output):
            continue
        output.append((box, confidence))
        if len(output) >= 3:
            break
    return output


def choose_layout_template(face_tracks: list[_Track], structure_tracks: list[_Track]) -> str:
    """Return a deliberately limited baseline recommendation for one sample.

    It uses observed topology only. A normal talking head stays on the safe
    portrait fallback; a single face plus an independently detected internal
    rectangle becomes a screen/presenter candidate; three/four concurrent
    durable faces become panels. It never claims active-speaker identity.
    """
    faces = [track for track in face_tracks if track.observations >= 2]
    structures = [track for track in structure_tracks if track.observations >= 2]
    if len(faces) >= 4:
        return "grid_4"
    if len(faces) == 3:
        return "grid_3"
    if len(faces) == 1 and structures:
        return "screen_speaker"
    return "portrait_focus"


def _merge_segments(samples: list[dict[str, Any]], duration_ms: int) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for index, sample in enumerate(samples):
        end_ms = samples[index + 1]["atMs"] if index + 1 < len(samples) else duration_ms
        if end_ms <= sample["atMs"]:
            continue
        signature = (sample["template"], tuple(sample["regionIds"]))
        if segments and segments[-1]["_signature"] == signature and segments[-1]["endMs"] == sample["atMs"]:
            segments[-1]["endMs"] = end_ms
            continue
        segments.append({
            "_signature": signature,
            "startMs": sample["atMs"],
            "endMs": end_ms,
            "template": sample["template"],
            "regionIds": sample["regionIds"],
            "transitionLatencyMs": 0,
        })
    for segment in segments:
        segment.pop("_signature", None)
    return segments


def _candidate_provenance(model_set: VerifiedEvaluatorModelSet) -> dict[str, str]:
    face_model = model_set.require("mediapipe_face_landmarker")
    code_hash = _file_sha256(Path(__file__).resolve())
    return {
        "regionDetector": "hve-cv-structure-baseline",
        "regionModelVersion": "builtin-opencv-v1",
        # The region baseline is source code, not downloaded mutable weights.
        "regionModelSha256": code_hash,
        "faceDetector": "mediapipe-face-landmarker",
        "faceModelVersion": face_model.version,
        "faceModelSha256": face_model.sha256,
        "directorVersion": "hve-layout-director-baseline-v1",
        "directorCodeSha256": code_hash,
    }


def run_layout_candidate(
    *,
    source_video: Path,
    source_hash: str,
    duration_ms: int,
    models_manifest: Path,
    model_root: Path,
    output_path: Path,
    sampling_hz: int = 2,
) -> dict[str, Any]:
    """Run the bounded HVE-G6 candidate over evaluator-owned corpus media."""
    if duration_ms < 1 or not 1 <= sampling_hz <= 4:
        raise LayoutCandidateRuntimeError("layout candidate settings are outside supported bounds")
    if _file_sha256(source_video).lower() != source_hash.lower():
        raise ValueError("source video SHA-256 does not match --source-hash")
    model_set = verify_evaluator_models(manifest_path=models_manifest, model_root=model_root)
    try:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
    except ImportError as error:  # pragma: no cover - image-only dependency
        raise LayoutCandidateRuntimeError("MediaPipe/OpenCV is unavailable in this evaluator image") from error

    model = model_set.require("mediapipe_face_landmarker")
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(model.path)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=4,
        min_face_detection_confidence=0.70,
        min_face_presence_confidence=0.70,
        min_tracking_confidence=0.70,
        output_face_blendshapes=False,
    )
    detector = vision.FaceLandmarker.create_from_options(options)
    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        detector.close()
        raise LayoutCandidateRuntimeError("cannot open candidate video")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(fps) or fps <= 0:
        capture.release(); detector.close()
        raise LayoutCandidateRuntimeError("candidate video has no usable frame rate")

    started = __import__("time").monotonic()
    interval_ms = max(1, round(1_000 / sampling_hz))
    next_sample_ms = 0
    frame_index = 0
    tracks: list[_Track] = []
    archived_tracks: list[_Track] = []
    next_face_id, next_structure_id = 1, 1
    samples: list[dict[str, Any]] = []
    complete = True
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            at_ms = min(duration_ms - 1, int(round(frame_index * 1_000 / fps)))
            frame_index += 1
            if at_ms < next_sample_ms:
                continue
            next_sample_ms = at_ms + interval_ms
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            faces_result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), at_ms)
            observed_faces, next_face_id = _track_boxes(
                tracks, archived_tracks, _face_boxes(faces_result.face_landmarks), kind="face_candidate", prefix="face", at_ms=at_ms,
                next_id=next_face_id, minimum_iou=0.20,
            )
            observed_structures, next_structure_id = _track_boxes(
                tracks, archived_tracks, _structural_boxes(frame), kind="structure_candidate", prefix="structure", at_ms=at_ms,
                next_id=next_structure_id, minimum_iou=0.50,
            )
            template = choose_layout_template(observed_faces, observed_structures)
            # A decision records every directly used candidate; the evaluator
            # later maps only its IDs to semantic labels and evaluates visible
            # preservation without exposing a pixel or landmark.
            # Do not emit an ID that may disappear from the persisted artifact
            # after one noisy sample. The evaluator can only map durable,
            # retained candidate regions.
            durable_faces = [track for track in observed_faces if track.observations >= 2]
            durable_structures = [track for track in observed_structures if track.observations >= 2]
            selected = durable_faces[:4]
            if template == "screen_speaker":
                selected = durable_structures[:1] + durable_faces[:1]
            samples.append({"atMs": at_ms, "template": template, "regionIds": [track.region_id for track in selected]})
    except Exception as error:  # native MediaPipe errors have no stable base
        complete = False
        raise LayoutCandidateRuntimeError("layout candidate did not complete") from error
    finally:
        capture.release()
        detector.close()
    if frame_index == 0:
        raise LayoutCandidateRuntimeError("candidate video has no decodable frames")
    observed_end_ms = int(round((frame_index - 1) * 1_000 / fps))
    complete = complete and observed_end_ms >= max(0, duration_ms - max(1_500, interval_ms * 2))
    if not complete:
        raise LayoutCandidateRuntimeError("candidate decoder did not cover the declared source duration")
    segments = _merge_segments(samples, duration_ms)
    artifact = {
        "schemaVersion": 1,
        "kind": "hve-layout-candidate-run-v1",
        "sourceHash": source_hash.lower(),
        "durationMs": duration_ms,
        "candidate": _candidate_provenance(model_set),
        "regions": [
            {
                "regionId": track.region_id,
                "kind": track.kind,
                "range": {"startMs": track.first_ms, "endMs": min(duration_ms, track.last_ms + interval_ms)},
                "box": track.box.as_dict(),
                "observations": track.observations,
                "confidence": round(track.confidence, 6),
            }
            for track in sorted([*archived_tracks, *tracks], key=lambda item: item.region_id)
            if item.observations >= 2
        ],
        "segments": segments,
        "measurement": _measurement(started, duration_ms),
    }
    artifact["artifactSha256"] = sha256(json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
    _write_once(output_path, artifact)
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(description="Run evaluator-only HVE-G6 layout candidate inference.")
    parser.add_argument("--source-video", required=True, type=Path)
    parser.add_argument("--source-hash", required=True)
    parser.add_argument("--duration-ms", required=True, type=int)
    parser.add_argument("--models-manifest", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--sampling-hz", type=int, default=2)
    arguments = parser.parse_args()
    try:
        artifact = run_layout_candidate(
            source_video=arguments.source_video,
            source_hash=arguments.source_hash,
            duration_ms=arguments.duration_ms,
            models_manifest=arguments.models_manifest,
            model_root=arguments.model_root,
            output_path=arguments.out,
            sampling_hz=arguments.sampling_hz,
        )
    except (OSError, ValueError, ModelManifestError, LayoutCandidateRuntimeError) as error:
        parser.exit(2, f"HVE layout candidate rejected: {error}\n")
    print(json.dumps({"status": "completed", "output": str(arguments.out), "measurement": artifact["measurement"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
