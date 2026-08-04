import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.vision import (
    FaceObservation,
    FaceTrack,
    associate_faces,
    crop_window,
    classify_face_topology,
    normalized_face_observation,
    smooth_crop_track,
    SparseSourcePerception,
)
from fourshort_worker.config import Settings
from fourshort_worker.errors import JobError
from fourshort_worker.model_assets import face_detector_readiness, verify_face_detector_model


class VisionMathTests(unittest.TestCase):
    def test_yunet_detector_can_be_constructed_from_the_verified_model(self):
        """Exercise the real OpenCV/YuNet boundary when an image ships it.

        Development environments deliberately do not need the production
        model pack, so an unavailable model is a skip here.  CI invokes this
        exact test *inside* the production worker image, where a skip would
        be a release regression: the Dockerfile installs the immutable model
        and enables face tracking by default.
        """
        try:
            import cv2
        except ImportError:
            self.skipTest("OpenCV runtime is unavailable")

        settings = Settings(
            worker_api_token="test",
            s3_access_key_id="test",
            s3_secret_access_key="test",
        )
        ready, reason = face_detector_readiness(settings)
        if not ready:
            self.skipTest(f"YuNet model is not provisioned locally: {reason}")

        detector_model = verify_face_detector_model(settings)
        detector = cv2.FaceDetectorYN.create(
            str(detector_model.path),
            "",
            (160, 90),
            settings.face_detector_score_threshold,
            0.3,
            5_000,
        )
        self.assertIsNotNone(detector)

    def test_cancelled_face_tracking_stops_before_opening_the_source(self):
        from fourshort_worker.vision import YuNetFaceTracker

        cancelled = threading.Event()
        cancelled.set()
        settings = Settings(worker_api_token="test", s3_access_key_id="test", s3_secret_access_key="test")
        with self.assertRaises(JobError) as context:
            YuNetFaceTracker(settings).analyze(
                "https://example.invalid/source.mp4", 0, 1_000, 1080, 1920,
                cancellation_event=cancelled,
            )
        self.assertEqual(context.exception.code, "JOB_CANCELLED")

    def test_cancelled_sparse_analysis_stops_before_opening_the_source(self):
        cancelled = threading.Event()
        cancelled.set()
        settings = Settings(worker_api_token="test", s3_access_key_id="test", s3_secret_access_key="test")
        with self.assertRaises(JobError) as context:
            SparseSourcePerception(settings).analyze(
                "https://example.invalid/source.mp4",
                source_id="11111111-1111-4111-8111-111111111111",
                source_hash="a" * 64,
                cancellation_event=cancelled,
            )
        self.assertEqual(context.exception.code, "JOB_CANCELLED")

    def test_association_keeps_a_stable_track_id(self):
        tracks = [FaceTrack(1, [FaceObservation(0, 0.1, 0.1, 0.2, 0.2, 0.99)])]
        next_id = associate_faces(
            tracks,
            [FaceObservation(333, 0.12, 0.1, 0.2, 0.2, 0.98)],
            2,
        )
        self.assertEqual(next_id, 2)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(len(tracks[0].observations), 2)

    def test_crop_window_tracks_horizontal_face_position(self):
        left = crop_window(FaceObservation(0, 0.05, 0.2, 0.1, 0.2, 0.9), 1920, 1080, 9 / 16)
        right = crop_window(FaceObservation(0, 0.85, 0.2, 0.1, 0.2, 0.9), 1920, 1080, 9 / 16)
        self.assertLess(left["x"], right["x"])
        self.assertAlmostEqual(left["width"] / left["height"], (9 / 16) / (1920 / 1080), places=3)

    def test_smoothing_reduces_camera_jump(self):
        result = smooth_crop_track([
            {"atMs": 0, "x": 0.0, "y": 0.5, "width": 0.3, "height": 1.0, "confidence": 1},
            {"atMs": 333, "x": 1.0, "y": 0.5, "width": 0.3, "height": 1.0, "confidence": 1},
        ], 0.8)
        self.assertAlmostEqual(result[1]["x"], 0.2)

    def test_motion_association_keeps_ids_when_two_faces_cross(self):
        # At t=0/100 the left person moves right and the right person moves
        # left. At t=200 their boxes are close enough that last-box-only IoU
        # may swap IDs. Prediction must retain each trajectory.
        tracks = [
            FaceTrack(1, [
                FaceObservation(0, 0.10, 0.2, 0.1, 0.1, 0.99),
                FaceObservation(100, 0.30, 0.2, 0.1, 0.1, 0.99),
            ]),
            FaceTrack(2, [
                FaceObservation(0, 0.70, 0.2, 0.1, 0.1, 0.99),
                FaceObservation(100, 0.50, 0.2, 0.1, 0.1, 0.99),
            ]),
        ]
        associate_faces(tracks, [
            FaceObservation(200, 0.50, 0.2, 0.1, 0.1, 0.99),
            FaceObservation(200, 0.30, 0.2, 0.1, 0.1, 0.99),
        ], 3)
        self.assertGreater(tracks[0].last.center[0], tracks[1].last.center[0])

    def test_normalized_observation_clips_detector_box_to_frame(self):
        observation = normalized_face_observation(
            at_ms=0, x=90, y=90, width=30, height=30,
            canvas_width=100, canvas_height=100, confidence=1.2,
        )
        assert observation is not None
        self.assertLessEqual(observation.x + observation.width, 1.0)
        self.assertLessEqual(observation.y + observation.height, 1.0)
        self.assertEqual(observation.confidence, 1.0)

    def test_face_topology_requires_durable_verified_tracks(self):
        def region(identifier, start_us=0, end_us=3_000_000, confidence=0.95, frames=2):
            return {
                "id": identifier, "kind": "face", "confidence": confidence,
                "range": {"startUs": start_us, "endUs": end_us},
                "keyframes": [{} for _ in range(frames)],
            }
        probabilities, evidence = classify_face_topology(
            [region("one"), region("two"), region("three"), region("four")],
            start_ms=0,
            end_ms=3_000,
        )
        self.assertEqual(probabilities["remote_grid"], 0.76)
        self.assertEqual(evidence, ["four_or_more_persistent_face_tracks"])
        probabilities, _ = classify_face_topology([region("brief", end_us=300_000)], start_ms=0, end_ms=3_000)
        self.assertEqual(probabilities, {"unknown": 1.0})

    def test_sparse_source_perception_persists_facts_not_frames(self):
        try:
            import cv2
            import numpy as np
        except ImportError:
            self.skipTest("OpenCV runtime is unavailable")
        with TemporaryDirectory() as directory:
            path = Path(directory) / "source.mp4"
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 36))
            if not writer.isOpened():
                self.skipTest("OpenCV video writer is unavailable")
            for colour in ((0, 0, 255), (0, 255, 0)):
                for _ in range(10):
                    writer.write(np.full((36, 64, 3), colour, dtype=np.uint8))
            writer.release()
            settings = Settings(
                worker_api_token="test",
                s3_access_key_id="test",
                s3_secret_access_key="test",
                face_tracking_enabled=False,
                vision_source_sample_fps=2.0,
            )
            graph = SparseSourcePerception(settings).analyze(
                str(path),
                source_id="11111111-1111-4111-8111-111111111111",
                source_hash="a" * 64,
                duration_ms_hint=2000,
            )
            self.assertEqual(graph["durationUs"], 2_000_000)
            self.assertEqual(graph["speakerTurns"], [])
            self.assertEqual(graph["activeSpeakerLinks"], [])
            self.assertGreaterEqual(len(graph["shots"]), 1)
            # 20 frames at 10 fps sampled at 2 fps means four requested
            # positions (0, 5, 10, 15).  This guards against regressing to a
            # loop that decodes every intervening frame and only discards it
            # after reading.
            self.assertEqual(graph["_summary"]["sampleCount"], 4)
            # A serialized artifact contains geometry and timings only.  No
            # decoded frame, image bytes, embedding or raw OpenCV object can
            # cross the worker boundary.
            import json
            public_graph = {key: value for key, value in graph.items() if key != "_summary"}
            serialized = json.dumps(public_graph)
            self.assertNotIn("frame", serialized.lower())
            self.assertNotIn("embedding", serialized.lower())

    def test_selected_range_uses_dense_clock_but_retains_full_source_duration(self):
        try:
            import cv2
            import numpy as np
        except ImportError:
            self.skipTest("OpenCV runtime is unavailable")
        with TemporaryDirectory() as directory:
            path = Path(directory) / "source.mp4"
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 36))
            if not writer.isOpened():
                self.skipTest("OpenCV video writer is unavailable")
            for colour in ((0, 0, 255), (0, 255, 0)):
                for _ in range(10):
                    writer.write(np.full((36, 64, 3), colour, dtype=np.uint8))
            writer.release()
            settings = Settings(
                worker_api_token="test",
                s3_access_key_id="test",
                s3_secret_access_key="test",
                face_tracking_enabled=False,
                vision_source_sample_fps=0.5,
            )
            graph = SparseSourcePerception(settings).analyze(
                str(path),
                source_id="11111111-1111-4111-8111-111111111111",
                source_hash="a" * 64,
                duration_ms_hint=2_000,
                range_start_ms=500,
                range_end_ms=1_500,
                sample_fps=3.0,
                maximum_samples=30,
            )
            self.assertEqual(graph["durationUs"], 2_000_000)
            self.assertEqual(graph["classifications"][0]["range"], {"startUs": 500_000, "endUs": 1_500_000})
            self.assertEqual(graph["_summary"]["density"], "dense")
            self.assertEqual(graph["_summary"]["coverage"], [{"startUs": 500_000, "endUs": 1_500_000}])
            # 10 fps with a 3 fps request uses an interval of three encoded
            # frames: 5, 8, 11 and 14 in the selected [500, 1500) ms range.
            self.assertEqual(graph["_summary"]["sampleCount"], 4)


if __name__ == "__main__":
    unittest.main()
