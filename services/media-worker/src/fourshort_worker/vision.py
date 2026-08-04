from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import math
import threading

from .config import Settings
from .errors import JobError
from .model_assets import face_detector_readiness, verify_face_detector_model


def _assert_not_cancelled(cancellation_event: threading.Event | None) -> None:
    """Abort a visual pass that no longer owns its lease.

    Sparse source analysis and dense clip tracking can each run long enough
    for an operator cancellation or an expired lease to occur. The worker's
    heartbeat observes that state, but the decoder loops must also stop before
    producing an obsolete artifact or needlessly consuming the heavy slot.
    """
    if cancellation_event is not None and cancellation_event.is_set():
        raise JobError(
            "JOB_CANCELLED",
            "Job lease was cancelled or reassigned during visual analysis",
            retryable=False,
        )


@dataclass
class FaceObservation:
    at_ms: int
    x: float
    y: float
    width: float
    height: float
    confidence: float

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.width / 2, self.y + self.height / 2

    @property
    def area(self) -> float:
        return self.width * self.height


@dataclass
class FaceTrack:
    track_id: int
    observations: list[FaceObservation] = field(default_factory=list)
    missed: int = 0

    @property
    def last(self) -> FaceObservation:
        return self.observations[-1]

    def predicted_center(self, at_ms: int) -> tuple[float, float]:
        """Extrapolate a short, bounded trajectory for association only.

        This is deliberately not a claim that the crop can predict a face
        between sparse observations. It simply avoids an order-dependent IoU
        match swapping stable identities when two people move past each other.
        The prediction is capped to a single observation interval, so a track
        that disappeared for several samples cannot jump across the frame.
        """
        latest = self.last
        if len(self.observations) < 2:
            return latest.center
        previous = self.observations[-2]
        elapsed = max(1, latest.at_ms - previous.at_ms)
        requested = max(0, at_ms - latest.at_ms)
        scale = min(1.0, requested / elapsed)
        previous_x, previous_y = previous.center
        latest_x, latest_y = latest.center
        return (
            min(1.0, max(0.0, latest_x + (latest_x - previous_x) * scale)),
            min(1.0, max(0.0, latest_y + (latest_y - previous_y) * scale)),
        )

    @property
    def score(self) -> float:
        if not self.observations:
            return 0
        persistence = len(self.observations)
        mean_area = sum(item.area for item in self.observations) / persistence
        mean_center_distance = sum(
            math.dist(item.center, (0.5, 0.45)) for item in self.observations
        ) / persistence
        return persistence * (mean_area + 0.02) / (1 + mean_center_distance)


def intersection_over_union(left: FaceObservation, right: FaceObservation) -> float:
    x1, y1 = max(left.x, right.x), max(left.y, right.y)
    x2 = min(left.x + left.width, right.x + right.width)
    y2 = min(left.y + left.height, right.y + right.height)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = left.area + right.area - intersection
    return intersection / union if union > 0 else 0.0


def associate_faces(tracks: list[FaceTrack], detections: list[FaceObservation], next_track_id: int) -> int:
    """Globally associate face detections with motion-aware, bounded tracks.

    The old tracker greedily claimed the first acceptable detection per track.
    Its output depended on track insertion order and could assign the same
    crossing pair differently on an identical frame sequence. We instead rank
    all feasible pairs, claim each track/detection at most once, and compare a
    detection against the predicted (not merely last observed) centre. This is
    a small ByteTrack-style association primitive without a heavy dependency.
    """
    active = [track for track in tracks if track.missed <= 4 and track.observations]
    candidate_pairs: list[tuple[float, int, int]] = []
    for track_index, track in enumerate(active):
        for detection_index, detection in enumerate(detections):
            predicted = track.predicted_center(detection.at_ms)
            distance = math.dist(predicted, detection.center)
            # Compare against the motion-projected box, not the last observed
            # box. Otherwise a crossing face can win merely because it still
            # overlaps the previous location more than the actual trajectory.
            predicted_box = FaceObservation(
                at_ms=detection.at_ms,
                x=predicted[0] - track.last.width / 2,
                y=predicted[1] - track.last.height / 2,
                width=track.last.width,
                height=track.last.height,
                confidence=track.last.confidence,
            )
            iou = intersection_over_union(predicted_box, detection)
            previous_area = max(track.last.area, 1e-6)
            scale_similarity = min(track.last.area, detection.area) / max(previous_area, detection.area, 1e-6)
            # A detection far from the predicted path cannot be rescued by a
            # coincidental large IoU after a scene change. The score stays
            # bounded and deterministic for equal inputs.
            distance_score = max(0.0, 1.0 - distance / 0.45)
            score = 0.50 * iou + 0.40 * distance_score + 0.10 * scale_similarity
            if score >= 0.22:
                candidate_pairs.append((score, track_index, detection_index))

    claimed_tracks: set[int] = set()
    claimed_detections: set[int] = set()
    for _, track_index, detection_index in sorted(candidate_pairs, key=lambda item: (-item[0], item[1], item[2])):
        if track_index in claimed_tracks or detection_index in claimed_detections:
            continue
        track = active[track_index]
        track.observations.append(detections[detection_index])
        track.missed = 0
        claimed_tracks.add(track_index)
        claimed_detections.add(detection_index)

    active_ids = {id(track) for track in active}
    for track in tracks:
        if id(track) in active_ids and id(track) not in {id(active[index]) for index in claimed_tracks}:
            track.missed += 1
    remaining = set(range(len(detections))) - claimed_detections
    for index in sorted(remaining):
        tracks.append(FaceTrack(next_track_id, [detections[index]]))
        next_track_id += 1
    return next_track_id


def normalized_face_observation(
    *,
    at_ms: int,
    x: float,
    y: float,
    width: float,
    height: float,
    canvas_width: int,
    canvas_height: int,
    confidence: float,
) -> FaceObservation | None:
    """Normalize a detector box once and guarantee an in-bounds rectangle."""
    if canvas_width <= 0 or canvas_height <= 0 or width <= 0 or height <= 0:
        return None
    normalized_x = min(1.0, max(0.0, x / canvas_width))
    normalized_y = min(1.0, max(0.0, y / canvas_height))
    normalized_width = min(1.0 - normalized_x, max(0.001, width / canvas_width))
    normalized_height = min(1.0 - normalized_y, max(0.001, height / canvas_height))
    if normalized_width <= 0 or normalized_height <= 0:
        return None
    return FaceObservation(
        at_ms=at_ms,
        x=normalized_x,
        y=normalized_y,
        width=normalized_width,
        height=normalized_height,
        confidence=max(0.0, min(confidence, 1.0)),
    )


def _ema(previous: float, current: float, smoothing: float) -> float:
    return previous * smoothing + current * (1 - smoothing)


def crop_window(observation: FaceObservation, source_width: int, source_height: int, target_aspect: float) -> dict:
    source_aspect = source_width / source_height
    if source_aspect >= target_aspect:
        crop_width, crop_height = source_height * target_aspect, float(source_height)
    else:
        crop_width, crop_height = float(source_width), source_width / target_aspect

    face_x, face_y = observation.center
    center_x_px = face_x * source_width
    # Put the face above the visual centre so shoulders/content remain visible.
    desired_top = face_y * source_height - crop_height * 0.30
    left = min(max(center_x_px - crop_width / 2, 0.0), max(source_width - crop_width, 0.0))
    top = min(max(desired_top, 0.0), max(source_height - crop_height, 0.0))
    horizontal_slack = max(source_width - crop_width, 1.0)
    vertical_slack = max(source_height - crop_height, 1.0)
    return {
        "atMs": observation.at_ms,
        "x": left / horizontal_slack if source_width > crop_width else 0.5,
        "y": top / vertical_slack if source_height > crop_height else 0.5,
        "width": crop_width / source_width,
        "height": crop_height / source_height,
        "confidence": observation.confidence,
    }


def smooth_crop_track(keyframes: list[dict], smoothing: float) -> list[dict]:
    if not keyframes:
        return []
    output = [dict(keyframes[0])]
    for keyframe in keyframes[1:]:
        previous = output[-1]
        output.append({
            **keyframe,
            "x": _ema(float(previous["x"]), float(keyframe["x"]), smoothing),
            "y": _ema(float(previous["y"]), float(keyframe["y"]), smoothing),
        })
    return output


def classify_face_topology(
    regions: list[dict],
    *,
    start_ms: int,
    end_ms: int,
    minimum_confidence: float = 0.70,
) -> tuple[dict[str, float], list[str]]:
    """Classify only durable face topology from verified face tracks.

    This deliberately answers a much narrower question than content analysis:
    how many independent faces are visibly tracked for a meaningful part of
    the inspected range. It does not infer who speaks, whether a frame is a
    podcast, or that a game/screen exists. That constrained evidence is enough
    for conservative split/grid recommendations in the internal director.
    """
    duration = max(1, end_ms - start_ms)
    sustained = 0
    for region in regions:
        if region.get("kind") != "face" or float(region.get("confidence", 0)) < minimum_confidence:
            continue
        range_value = region.get("range") if isinstance(region.get("range"), dict) else {}
        track_start = int(range_value.get("startUs", 0)) // 1000
        track_end = int(range_value.get("endUs", 0)) // 1000
        overlap = max(0, min(end_ms, track_end) - max(start_ms, track_start))
        # A face visible for less than 700ms or only one sparse sample is not
        # sufficient to turn a portrait clip into a split/grid composition.
        if overlap >= min(duration, 700) and len(region.get("keyframes", [])) >= 2:
            sustained += 1
    if sustained == 1:
        return {"solo": 0.86, "unknown": 0.14}, ["one_persistent_face_track"]
    if sustained == 2:
        return {"conversation": 0.78, "unknown": 0.22}, ["two_persistent_face_tracks"]
    if sustained == 3:
        return {"panel": 0.76, "unknown": 0.24}, ["three_persistent_face_tracks"]
    if sustained >= 4:
        return {"remote_grid": 0.76, "panel": 0.14, "unknown": 0.10}, ["four_or_more_persistent_face_tracks"]
    return {"unknown": 1.0}, ["no_durable_face_topology"]


class YuNetFaceTracker:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def available(self) -> bool:
        ready, _ = face_detector_readiness(self.settings)
        return ready

    def analyze(
        self,
        input_url: str,
        start_ms: int,
        end_ms: int,
        output_width: int,
        output_height: int,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        _assert_not_cancelled(cancellation_event)
        if not self.available:
            _, status = face_detector_readiness(self.settings)
            return {"cropTrack": [], "faceCount": 0, "fallback": "static_crop", "warnings": [status]}
        if end_ms <= start_ms:
            raise JobError("FACE_RANGE_INVALID", "Face tracking range is invalid", retryable=False)

        try:
            import cv2
        except ImportError as error:
            raise JobError("FACE_RUNTIME_MISSING", "OpenCV face runtime is not installed", retryable=False) from error

        capture = cv2.VideoCapture(input_url)
        if not capture.isOpened():
            raise JobError("FACE_SOURCE_OPEN_FAILED", "Could not open source for face tracking", retryable=True)
        source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 25)
        if source_width <= 0 or source_height <= 0:
            capture.release()
            raise JobError("FACE_SOURCE_INVALID", "Source dimensions are unavailable", retryable=True)

        detector_width = min(source_width, self.settings.face_detector_max_width)
        detector_height = max(1, round(source_height * detector_width / source_width))
        detector_model = verify_face_detector_model(self.settings)
        detector = cv2.FaceDetectorYN.create(
            str(detector_model.path),
            "",
            (detector_width, detector_height),
            self.settings.face_detector_score_threshold,
            0.3,
            5_000,
        )
        frame_interval = max(1, round(source_fps / max(self.settings.face_sample_fps, 0.5)))
        start_frame = max(0, round(start_ms / 1000 * source_fps))
        end_frame = max(start_frame + 1, round(end_ms / 1000 * source_fps))
        capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        tracks: list[FaceTrack] = []
        next_track_id = 1
        frame_index = start_frame
        try:
            while frame_index < end_frame:
                _assert_not_cancelled(cancellation_event)
                ok, frame = capture.read()
                if not ok:
                    break
                if (frame_index - start_frame) % frame_interval == 0:
                    resized = cv2.resize(frame, (detector_width, detector_height), interpolation=cv2.INTER_AREA)
                    detector.setInputSize((detector_width, detector_height))
                    _, faces = detector.detect(resized)
                    at_ms = max(0, round(frame_index / source_fps * 1000) - start_ms)
                    detections: list[FaceObservation] = []
                    if faces is not None:
                        for face in faces:
                            x, y, width, height = [float(value) for value in face[:4]]
                            confidence = float(face[-1])
                            observation = normalized_face_observation(
                                at_ms=at_ms,
                                x=x,
                                y=y,
                                width=width,
                                height=height,
                                canvas_width=detector_width,
                                canvas_height=detector_height,
                                confidence=confidence,
                            )
                            if observation is not None:
                                detections.append(observation)
                    next_track_id = associate_faces(tracks, detections, next_track_id)
                frame_index += 1
        finally:
            capture.release()

        viable = [track for track in tracks if len(track.observations) >= 2]
        if not viable:
            return {"cropTrack": [], "faceCount": 0, "fallback": "static_crop", "warnings": ["FACE_NOT_FOUND"]}
        primary = max(viable, key=lambda item: item.score)
        target_aspect = output_width / output_height
        smoothing = min(max(self.settings.face_track_smoothing, 0.0), 0.98)
        face_tracks = [{
            "trackId": track.track_id,
            "confidence": sum(item.confidence for item in track.observations) / len(track.observations),
            "keyframes": smooth_crop_track(
                [crop_window(item, source_width, source_height, target_aspect) for item in track.observations],
                smoothing,
            ),
        } for track in sorted(viable, key=lambda item: item.score, reverse=True)[:4]]
        crop_track = next(item["keyframes"] for item in face_tracks if item["trackId"] == primary.track_id)
        warnings = []
        if len(viable) > 1:
            warnings.append("ACTIVE_SPEAKER_MODEL_PENDING")
        return {
            "cropTrack": crop_track,
            "faceTracks": face_tracks,
            "faceCount": len(viable),
            "primaryTrackId": primary.track_id,
            "fallback": None,
            "warnings": warnings,
        }


class SparseSourcePerception:
    """Create an immutable, sparse HVE-5 scene graph from a source.

    This pass is deliberately source-scoped and cheap: it stores only cuts,
    low-frequency face boxes and explicit uncertainty.  Frames, embeddings and
    an inferred "active speaker" are never put in the graph.  Dense tracking
    belongs to a selected clip later in the pipeline.
    """

    def __init__(self, settings: Settings):
        self.settings = settings

    def analyze(
        self,
        input_url: str,
        *,
        source_id: str,
        source_hash: str,
        duration_ms_hint: int | None = None,
        range_start_ms: int = 0,
        range_end_ms: int | None = None,
        sample_fps: float | None = None,
        maximum_samples: int | None = None,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        _assert_not_cancelled(cancellation_event)
        if len(source_hash) != 64 or any(char not in "0123456789abcdefABCDEF" for char in source_hash):
            raise JobError("VISION_SOURCE_HASH_INVALID", "Source hash is required for visual analysis", retryable=False)
        try:
            import cv2
        except ImportError as error:
            raise JobError("VISION_RUNTIME_MISSING", "OpenCV visual analysis runtime is not installed", retryable=False) from error

        capture = cv2.VideoCapture(input_url)
        if not capture.isOpened():
            raise JobError("VISION_SOURCE_OPEN_FAILED", "Could not open source for visual analysis", retryable=True)

        source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 25.0)
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if source_width <= 0 or source_height <= 0 or source_fps <= 0:
            capture.release()
            raise JobError("VISION_SOURCE_INVALID", "Source dimensions are unavailable", retryable=True)
        duration_ms = int(duration_ms_hint or round(frame_count / source_fps * 1000))
        if duration_ms <= 0:
            capture.release()
            raise JobError("VISION_DURATION_INVALID", "Source duration is unavailable", retryable=True)

        analysis_start_ms = max(0, int(range_start_ms))
        analysis_end_ms = min(duration_ms, int(range_end_ms) if range_end_ms is not None else duration_ms)
        if analysis_start_ms >= analysis_end_ms:
            capture.release()
            raise JobError("VISION_RANGE_INVALID", "Visual analysis range is invalid", retryable=False)

        effective_sample_fps = max(0.1, min(float(sample_fps or self.settings.vision_source_sample_fps), 4.0))
        interval = max(1, round(source_fps / effective_sample_fps))
        effective_maximum_samples = max(1, int(maximum_samples or self.settings.vision_source_max_samples))
        detector = self._detector(cv2, source_width, source_height)
        detector_width = min(source_width, self.settings.face_detector_max_width)
        detector_height = max(1, round(source_height * detector_width / source_width))
        tracks: list[FaceTrack] = []
        next_track_id = 1
        warnings: list[dict] = []
        if detector is None:
            warnings.append({
                "code": "HVE_VISION_FACE_DETECTOR_UNAVAILABLE",
                "userMessage": "Лица не анализировались: детектор недоступен. Остальной анализ продолжен.",
                "severity": "warning",
            })

        previous_histogram = None
        cut_times_ms = [analysis_start_ms]
        samples = 0
        start_frame = max(0, round(analysis_start_ms / 1000 * source_fps))
        end_frame = max(start_frame + 1, min(frame_count or round(analysis_end_ms / 1000 * source_fps), round(analysis_end_ms / 1000 * source_fps)))
        # Do not merely *discard* frames between sparse samples.  Calling
        # ``read`` for every source frame still decodes a four-hour podcast
        # end-to-end at 0.5 fps and turns an advisory perception pass into a
        # queue blocker.  Seek to each requested sample instead.  OpenCV/FFmpeg
        # may decode a short GOP internally to satisfy a seek, but Python only
        # receives the bounded number of frames reflected in ``sampleCount``.
        #
        # The requested frame index remains the artifact clock.  Container
        # seeking is not frame-exact for VFR sources, so a later VFR-aware
        # proxy/index stage can improve it without silently changing this
        # evidence contract.
        sample_frame = start_frame
        try:
            while samples < effective_maximum_samples and sample_frame < end_frame:
                _assert_not_cancelled(cancellation_event)
                capture.set(cv2.CAP_PROP_POS_FRAMES, sample_frame)
                ok, frame = capture.read()
                if not ok:
                    break
                at_ms = min(analysis_end_ms - 1, max(analysis_start_ms, round(sample_frame / source_fps * 1000)))
                low_frame = cv2.resize(frame, (160, max(1, round(160 * source_height / source_width))), interpolation=cv2.INTER_AREA)
                histogram = cv2.calcHist([cv2.cvtColor(low_frame, cv2.COLOR_BGR2HSV)], [0, 1], None, [12, 8], [0, 180, 0, 256])
                histogram = cv2.normalize(histogram, None).flatten()
                if previous_histogram is not None:
                    delta = float(cv2.compareHist(previous_histogram, histogram, cv2.HISTCMP_BHATTACHARYYA))
                    if delta >= self.settings.vision_scene_cut_threshold and at_ms - cut_times_ms[-1] >= 250:
                        cut_times_ms.append(at_ms)
                previous_histogram = histogram

                if detector is not None:
                    resized = cv2.resize(frame, (detector_width, detector_height), interpolation=cv2.INTER_AREA)
                    detector.setInputSize((detector_width, detector_height))
                    _, faces = detector.detect(resized)
                    detections: list[FaceObservation] = []
                    if faces is not None:
                        for face in faces:
                            x, y, width, height = [float(value) for value in face[:4]]
                            confidence = float(face[-1])
                            observation = normalized_face_observation(
                                at_ms=at_ms,
                                x=x,
                                y=y,
                                width=width,
                                height=height,
                                canvas_width=detector_width,
                                canvas_height=detector_height,
                                confidence=confidence,
                            )
                            if observation is not None:
                                detections.append(observation)
                    next_track_id = associate_faces(tracks, detections, next_track_id)
                samples += 1
                sample_frame += interval
        finally:
            capture.release()

        if samples >= effective_maximum_samples:
            warnings.append({
                "code": "HVE_VISION_SAMPLE_CAP_REACHED",
                "userMessage": "Анализ изображения выполнен с ограниченной частотой кадров.",
                "severity": "info",
            })

        duration_us = duration_ms * 1000
        cut_points = sorted({max(analysis_start_ms, min(analysis_end_ms - 1, value)) for value in cut_times_ms})
        shots = []
        for index, start_ms in enumerate(cut_points):
            end_ms = cut_points[index + 1] if index + 1 < len(cut_points) else analysis_end_ms
            if end_ms <= start_ms:
                continue
            shots.append({
                "id": f"shot-{index + 1}",
                "range": {"startUs": start_ms * 1000, "endUs": end_ms * 1000},
                "confidence": 0.8 if index else 1.0,
                "reason": "histogram_cut" if index else "unknown",
            })

        regions = []
        for track in sorted((item for item in tracks if len(item.observations) >= 2), key=lambda item: item.score, reverse=True)[:16]:
            first_ms = track.observations[0].at_ms
            last_ms = track.observations[-1].at_ms
            end_ms = min(analysis_end_ms, max(last_ms + max(1, round(1000 / effective_sample_fps)), first_ms + 1))
            keyframes = [{
                "atUs": observation.at_ms * 1000,
                "box": {
                    "x": observation.x,
                    "y": observation.y,
                    "width": min(observation.width, 1.0 - observation.x),
                    "height": min(observation.height, 1.0 - observation.y),
                },
                "confidence": observation.confidence,
            } for observation in track.observations if observation.at_ms * 1000 < end_ms * 1000]
            if not keyframes:
                continue
            regions.append({
                "id": f"face-{track.track_id}",
                "kind": "face",
                "range": {"startUs": first_ms * 1000, "endUs": end_ms * 1000},
                "keyframes": keyframes,
                "confidence": round(sum(item.confidence for item in track.observations) / len(track.observations), 4),
                "provenance": {
                    "detector": "opencv-yunet",
                    "modelVersion": self.settings.face_detector_fingerprint or self.settings.face_detector_model.name,
                },
            })

        probabilities, evidence = classify_face_topology(
            regions,
            start_ms=analysis_start_ms,
            end_ms=analysis_end_ms,
        )
        is_dense_clip_scope = analysis_start_ms > 0 or analysis_end_ms < duration_ms or effective_sample_fps > self.settings.vision_source_sample_fps
        evidence.append("dense_clip_visual_analysis_only" if is_dense_clip_scope else "sparse_visual_analysis_only")
        if source_height > source_width:
            probabilities = {"vertical_source": 1.0}
            evidence = ["source_geometry_vertical", *evidence]
        return {
            "schemaVersion": 1,
            "sourceId": source_id,
            "sourceHash": source_hash.lower(),
            "engineVersion": self.settings.hve_engine_version,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "durationUs": duration_us,
            "shots": shots,
            "regions": regions,
            "speakerTurns": [],
            "activeSpeakerLinks": [],
            "classifications": [{
                "range": {"startUs": analysis_start_ms * 1000, "endUs": analysis_end_ms * 1000},
                "probabilities": probabilities,
                "evidence": evidence,
            }],
            "warnings": warnings,
            # Private run summary: it is stripped before persistence; raw
            # frames and embeddings never leave this worker process.
            "_summary": {
                "sampleCount": samples,
                "faceTrackCount": len(regions),
                "coverage": [{"startUs": analysis_start_ms * 1000, "endUs": analysis_end_ms * 1000}],
                "density": "dense" if is_dense_clip_scope else "sparse",
            },
        }

    def _detector(self, cv2, source_width: int, source_height: int):
        if not self.settings.face_tracking_enabled:
            return None
        try:
            detector_model = verify_face_detector_model(self.settings)
        except JobError:
            return None
        detector_width = min(source_width, self.settings.face_detector_max_width)
        detector_height = max(1, round(source_height * detector_width / source_width))
        try:
            return cv2.FaceDetectorYN.create(
                str(detector_model.path),
                "",
                (detector_width, detector_height),
                self.settings.face_detector_score_threshold,
                0.3,
                5_000,
            )
        except cv2.error:
            return None
