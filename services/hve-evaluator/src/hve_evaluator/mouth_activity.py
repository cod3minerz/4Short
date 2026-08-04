"""MediaPipe video-mode adapter for compact mouth-motion evidence.

Landmarks are kept only while one sampled frame is processed.  The output has
track IDs and aggregate activity windows — never a raw frame, landmark vector,
embedding or media locator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from pathlib import Path
from typing import Any

from .model_manifest import VerifiedEvaluatorModelSet


class MouthActivityRuntimeError(RuntimeError):
    """Raised when the evaluator cannot produce complete visual evidence."""


@dataclass
class _FaceTrack:
    track_id: str
    center: tuple[float, float]
    bounds: tuple[float, float, float, float]
    last_opening: float | None = None
    missed: int = 0


def _iou(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    left_x, left_y, left_w, left_h = left
    right_x, right_y, right_w, right_h = right
    x1, y1 = max(left_x, right_x), max(left_y, right_y)
    x2, y2 = min(left_x + left_w, right_x + right_w), min(left_y + left_h, right_y + right_h)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = left_w * left_h + right_w * right_h - intersection
    return intersection / union if union else 0.0


def _bounds(landmarks: Any) -> tuple[float, float, float, float] | None:
    if len(landmarks) <= 152:
        return None
    xs = [float(point.x) for point in landmarks]
    ys = [float(point.y) for point in landmarks]
    x, y = max(0.0, min(xs)), max(0.0, min(ys))
    width, height = min(1.0, max(xs)) - x, min(1.0, max(ys)) - y
    if width < 0.02 or height < 0.02:
        return None
    return x, y, width, height


def _mouth_opening(landmarks: Any, face_bounds: tuple[float, float, float, float]) -> float:
    # MediaPipe Face Landmarker indices: 13/14 are inner lip landmarks and
    # 10/152 bound forehead-to-chin.  We normalise to face height to avoid
    # accidental dependence on a person's distance from the camera.
    upper, lower = landmarks[13], landmarks[14]
    _, _, _, face_height = face_bounds
    return math.dist((float(upper.x), float(upper.y)), (float(lower.x), float(lower.y))) / max(face_height, 1e-6)


def _activity(opening: float, previous: float | None) -> float:
    baseline = max(0.0, min(1.0, (opening - 0.010) / 0.055))
    delta = 0.0 if previous is None else max(0.0, min(1.0, abs(opening - previous) / 0.030))
    return max(0.0, min(1.0, 0.75 * baseline + 0.25 * delta))


def _assign_tracks(tracks: list[_FaceTrack], detections: list[tuple[tuple[float, float, float, float], float]]) -> list[_FaceTrack]:
    pairs: list[tuple[float, int, int]] = []
    for track_index, track in enumerate(tracks):
        for detection_index, (bounds, _) in enumerate(detections):
            x, y, width, height = bounds
            center = x + width / 2, y + height / 2
            distance = math.dist(track.center, center)
            score = 0.70 * _iou(track.bounds, bounds) + 0.30 * max(0.0, 1.0 - distance / 0.35)
            if score >= 0.24:
                pairs.append((score, track_index, detection_index))
    claimed_tracks: set[int] = set()
    claimed_detections: set[int] = set()
    assigned: list[_FaceTrack | None] = [None] * len(detections)
    for _, track_index, detection_index in sorted(pairs, key=lambda item: (-item[0], item[1], item[2])):
        if track_index in claimed_tracks or detection_index in claimed_detections:
            continue
        track = tracks[track_index]
        bounds, _ = detections[detection_index]
        x, y, width, height = bounds
        track.center, track.bounds, track.missed = (x + width / 2, y + height / 2), bounds, 0
        assigned[detection_index] = track
        claimed_tracks.add(track_index)
        claimed_detections.add(detection_index)
    for index, track in enumerate(tracks):
        if index not in claimed_tracks:
            track.missed += 1
    next_index = max((int(track.track_id.rsplit("-", 1)[-1]) for track in tracks), default=-1) + 1
    for detection_index, (bounds, _) in enumerate(detections):
        if assigned[detection_index] is not None:
            continue
        x, y, width, height = bounds
        track = _FaceTrack(f"mediapipe-face-{next_index:02d}", (x + width / 2, y + height / 2), bounds)
        next_index += 1
        tracks.append(track)
        assigned[detection_index] = track
    tracks[:] = [track for track in tracks if track.missed <= 3]
    return [track for track in assigned if track is not None]


def run_mediapipe_mouth_activity(
    *,
    video_path: Path,
    source_hash: str,
    duration_ms: int,
    model_set: VerifiedEvaluatorModelSet,
    sampling_hz: int = 4,
    max_faces: int = 4,
) -> dict[str, Any]:
    """Decode a video sequentially and derive bounded per-track motion windows."""
    if duration_ms < 1 or not 1 <= sampling_hz <= 6 or not 1 <= max_faces <= 4:
        raise MouthActivityRuntimeError("visual evaluator settings are outside supported bounds")
    try:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
    except ImportError as error:
        raise MouthActivityRuntimeError("MediaPipe is unavailable in this evaluator image") from error

    model = model_set.require("mediapipe_face_landmarker")
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(model.path)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=max_faces,
        min_face_detection_confidence=0.70,
        min_face_presence_confidence=0.70,
        min_tracking_confidence=0.70,
        output_face_blendshapes=False,
    )
    detector = vision.FaceLandmarker.create_from_options(options)
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        detector.close()
        raise MouthActivityRuntimeError("cannot open candidate video")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(fps) or fps <= 0:
        capture.release()
        detector.close()
        raise MouthActivityRuntimeError("candidate video has no usable frame rate")
    interval_ms = max(1, int(round(1_000 / sampling_hz)))
    next_sample_ms = 0
    frame_index = 0
    tracks: list[_FaceTrack] = []
    windows: list[dict[str, Any]] = []
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
            result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), at_ms)
            faces: list[tuple[tuple[float, float, float, float], float]] = []
            for landmarks in result.face_landmarks:
                bounds = _bounds(landmarks)
                if bounds is not None:
                    faces.append((bounds, _mouth_opening(landmarks, bounds)))
            assigned = _assign_tracks(tracks, faces)
            for index, track in enumerate(assigned):
                _, opening = faces[index]
                activity = _activity(opening, track.last_opening)
                track.last_opening = opening
                windows.append({
                    "faceTrackId": track.track_id,
                    "startMs": at_ms,
                    "endMs": min(duration_ms, at_ms + interval_ms),
                    # FaceLandmarker returns landmarks rather than a calibrated
                    # confidence score. Record its configured 0.70 acceptance
                    # floor, not a made-up per-frame confidence.
                    "activity": round(activity, 6),
                    "faceConfidence": 0.70,
                })
    except Exception as error:  # native task errors have no public stable base class
        complete = False
        raise MouthActivityRuntimeError("MediaPipe Face Landmarker did not complete") from error
    finally:
        capture.release()
        detector.close()
    if frame_index == 0:
        raise MouthActivityRuntimeError("candidate video has no decodable frames")
    # A decoder that finishes substantially before the declared corpus duration
    # cannot support an off-screen conclusion for the tail.
    observed_end_ms = int(round((frame_index - 1) * 1_000 / fps))
    complete = complete and observed_end_ms >= max(0, duration_ms - max(1_500, interval_ms * 2))
    return {
        "schemaVersion": 1,
        "sourceHash": source_hash,
        "durationMs": duration_ms,
        "engine": "mediapipe-face-landmarker-video",
        "modelVersion": f"mediapipe-{getattr(mp, '__version__', 'unknown')}:{model.version}",
        "faceAnalysisComplete": complete,
        "windows": windows,
    }
