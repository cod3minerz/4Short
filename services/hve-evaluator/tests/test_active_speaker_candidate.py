import hashlib
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[2] / "media-worker" / "src"))
sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from hve_evaluator.active_speaker_candidate import _measurement, run_candidate


class ActiveSpeakerCandidateTests(unittest.TestCase):
    def _candidate_inputs(self, root: Path):
        video = root / "corpus.mp4"
        video.write_bytes(b"private corpus video")
        digest = hashlib.sha256(video.read_bytes()).hexdigest()
        diarization = {
            "schemaVersion": 1, "sourceHash": digest, "durationMs": 4_000,
            "engine": "sherpa-onnx-offline-diarization", "modelVersion": "sherpa-test",
            "turns": [{"speakerId": "s0", "startMs": 0, "endMs": 4_000, "confidence": 0.95}],
        }
        mouth = {
            "schemaVersion": 1, "sourceHash": digest, "durationMs": 4_000,
            "engine": "mediapipe-face-landmarker-video", "modelVersion": "mediapipe-test",
            "faceAnalysisComplete": True,
            "windows": [{"faceTrackId": "face-0", "startMs": 0, "endMs": 4_000, "activity": 0.95, "faceConfidence": 0.95}],
        }

        class ModelSet:
            fingerprint = "a" * 64

        return video, digest, diarization, mouth, ModelSet()

    def test_candidate_binds_media_hash_and_writes_private_bounded_artifacts(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            video, digest, diarization, mouth, model_set = self._candidate_inputs(root)
            output = root / "out"
            with patch("hve_evaluator.active_speaker_candidate.verify_evaluator_models", return_value=model_set), \
                patch("hve_evaluator.active_speaker_candidate._extract_pcm16_audio", return_value=root / "scratch.wav"), \
                patch("hve_evaluator.active_speaker_candidate.run_sherpa_diarization", return_value=diarization), \
                patch("hve_evaluator.active_speaker_candidate.run_mediapipe_mouth_activity", return_value=mouth), \
                patch("hve_evaluator.active_speaker_candidate._measurement", return_value={"scope": "test", "peakRssBytes": 1_000_000, "sustainedSwapBytes": 0, "wallSeconds": 0, "mediaSeconds": 4, "coldStartSeconds": 0}):
                metadata = run_candidate(
                    source_video=video,
                    source_hash=digest,
                    duration_ms=4_000,
                    models_manifest=root / "models.json",
                    model_root=root,
                    output_dir=output,
                    scratch_dir=root / "scratch",
                    analysis_id="11111111-1111-4111-8111-111111111111",
                    source_id="22222222-2222-4222-8222-222222222222",
                )

            self.assertEqual(metadata["sourceHash"], digest)
            self.assertEqual(metadata["measurement"]["peakRssBytes"], 1_000_000)
            self.assertEqual(metadata["measurement"]["scope"], "test")
            for name in ["diarization.json", "mouth-activity.json", "active-speaker-artifact.json", "candidate-run.json"]:
                path = output / name
                self.assertTrue(path.is_file())
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            artifact = json.loads((output / "active-speaker-artifact.json").read_text("utf-8"))
            self.assertEqual(artifact["activeSpeakerLinks"][0]["faceTrackId"], "face-0")

    def test_candidate_publishes_no_partial_evidence_if_a_bundle_write_fails(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            video, digest, diarization, mouth, model_set = self._candidate_inputs(root)
            output = root / "out"
            with patch("hve_evaluator.active_speaker_candidate.verify_evaluator_models", return_value=model_set), \
                patch("hve_evaluator.active_speaker_candidate._extract_pcm16_audio", return_value=root / "scratch.wav"), \
                patch("hve_evaluator.active_speaker_candidate.run_sherpa_diarization", return_value=diarization), \
                patch("hve_evaluator.active_speaker_candidate.run_mediapipe_mouth_activity", return_value=mouth), \
                patch("hve_evaluator.active_speaker_candidate._measurement", return_value={"scope": "test", "peakRssBytes": 0, "sustainedSwapBytes": 0, "wallSeconds": 0, "mediaSeconds": 4, "coldStartSeconds": 0}), \
                patch("hve_evaluator.active_speaker_candidate._write_once", side_effect=OSError("disk full")):
                with self.assertRaisesRegex(OSError, "disk full"):
                    run_candidate(
                        source_video=video, source_hash=digest, duration_ms=4_000,
                        models_manifest=root / "models.json", model_root=root,
                        output_dir=output, scratch_dir=root / "scratch",
                        analysis_id="11111111-1111-4111-8111-111111111111",
                        source_id="22222222-2222-4222-8222-222222222222",
                    )
            self.assertFalse(output.exists())
            self.assertEqual(list(root.glob(".out.staging-*")), [])

    def test_candidate_never_overwrites_a_prior_evidence_bundle(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            video, digest, _, _, _ = self._candidate_inputs(root)
            output = root / "out"
            output.mkdir()
            sentinel = output / "candidate-run.json"
            sentinel.write_text('{"existing":true}\n', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "already exists"):
                run_candidate(
                    source_video=video, source_hash=digest, duration_ms=4_000,
                    models_manifest=root / "models.json", model_root=root,
                    output_dir=output, scratch_dir=root / "scratch",
                    analysis_id="11111111-1111-4111-8111-111111111111",
                    source_id="22222222-2222-4222-8222-222222222222",
                )
            self.assertEqual(sentinel.read_text(encoding="utf-8"), '{"existing":true}\n')

    def test_candidate_rejects_a_source_hash_not_matching_the_evaluated_video(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "corpus.mp4"
            video.write_bytes(b"private corpus video")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                run_candidate(
                    source_video=video,
                    source_hash="0" * 64,
                    duration_ms=4_000,
                    models_manifest=root / "models.json",
                    model_root=root,
                    output_dir=root / "out",
                    scratch_dir=root / "scratch",
                    analysis_id="11111111-1111-4111-8111-111111111111",
                    source_id="22222222-2222-4222-8222-222222222222",
                )

    def test_prefers_container_peak_and_swap_measurements_when_cgroup_v2_is_available(self):
        with patch("hve_evaluator.active_speaker_candidate._read_cgroup_number", side_effect=lambda name: {
            "memory.peak": 7_000_000,
            "memory.swap.peak": 0,
        }[name]), patch("hve_evaluator.active_speaker_candidate._process_age_seconds", return_value=0.5):
            measurement = _measurement(0.0, 4_000)
        self.assertEqual(measurement["scope"], "cgroup-v2")
        self.assertEqual(measurement["peakRssBytes"], 7_000_000)
        self.assertEqual(measurement["sustainedSwapBytes"], 0)
        self.assertEqual(measurement["mediaSeconds"], 4.0)
