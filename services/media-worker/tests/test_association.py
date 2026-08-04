import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.association import (
    MouthActivityWindow,
    SpeakerTurn,
    associate_active_speakers,
    build_active_speaker_artifact,
)
from fourshort_worker.active_speaker_evidence import (
    EvidenceValidationError,
    compile_active_speaker_evidence,
)


class ActiveSpeakerAssociationTests(unittest.TestCase):
    def test_maps_two_diarized_speakers_to_distinct_mouth_tracks(self):
        turns = [
            SpeakerTurn("speaker-a", 0, 2_000, 0.97),
            SpeakerTurn("speaker-b", 2_000, 4_000, 0.97),
            SpeakerTurn("speaker-a", 4_000, 6_000, 0.97),
            SpeakerTurn("speaker-b", 6_000, 8_000, 0.97),
        ]
        windows = [
            MouthActivityWindow("face-a", start, start + 2_000, 0.88 if index % 2 == 0 else 0.05, 0.94)
            for index, start in enumerate(range(0, 8_000, 2_000))
        ] + [
            MouthActivityWindow("face-b", start, start + 2_000, 0.88 if index % 2 else 0.05, 0.94)
            for index, start in enumerate(range(0, 8_000, 2_000))
        ]

        links = associate_active_speakers(turns, windows, face_analysis_complete=True)

        self.assertEqual([link.face_track_id for link in links], ["face-a", "face-b", "face-a", "face-b"])
        self.assertTrue(all(link.reason == "audio_video_association" for link in links))
        self.assertTrue(all(link.confidence >= 0.8 for link in links))

    def test_ambiguous_motion_never_assigns_a_face(self):
        turns = [
            SpeakerTurn("speaker-a", 0, 2_000, 0.96),
            SpeakerTurn("speaker-b", 2_000, 4_000, 0.96),
        ]
        windows = [
            MouthActivityWindow(face, start, start + 1_000, 0.50, 0.96)
            for face in ("face-a", "face-b")
            for start in range(0, 4_000, 1_000)
        ]

        links = associate_active_speakers(turns, windows, face_analysis_complete=True)

        self.assertEqual([link.face_track_id for link in links], [None, None])
        self.assertEqual([link.reason for link in links], ["insufficient_evidence", "insufficient_evidence"])

    def test_missing_face_windows_become_offscreen_only_after_complete_analysis(self):
        turn = SpeakerTurn("voiceover", 0, 2_000, 0.92)

        complete = associate_active_speakers([turn], [], face_analysis_complete=True)
        incomplete = associate_active_speakers([turn], [], face_analysis_complete=False)

        self.assertEqual(complete[0].reason, "offscreen")
        self.assertEqual(incomplete[0].reason, "insufficient_evidence")

    def test_short_turn_is_never_used_for_an_identity_switch(self):
        turn = SpeakerTurn("speaker-a", 0, 250, 0.99)
        windows = [MouthActivityWindow("face-a", 0, 250, 0.99, 0.99)]

        link = associate_active_speakers([turn], windows, face_analysis_complete=True)[0]

        self.assertIsNone(link.face_track_id)
        self.assertEqual(link.reason, "insufficient_evidence")

    def test_overlapping_diarized_turns_never_claim_a_speaking_face(self):
        turns = [
            SpeakerTurn("speaker-a", 0, 2_000, 0.99),
            SpeakerTurn("speaker-b", 1_000, 3_000, 0.99),
        ]
        windows = [
            MouthActivityWindow("face-a", 0, 3_000, 0.9, 0.99),
            MouthActivityWindow("face-b", 0, 3_000, 0.1, 0.99),
        ]

        links = associate_active_speakers(turns, windows, face_analysis_complete=True)

        self.assertEqual([link.face_track_id for link in links], [None, None])
        self.assertEqual([link.reason for link in links], ["insufficient_evidence", "insufficient_evidence"])

    def test_builds_bounded_immutable_association_artifact(self):
        artifact = build_active_speaker_artifact(
            analysis_id="11111111-1111-4111-8111-111111111111",
            source_id="22222222-2222-4222-8222-222222222222",
            source_hash="a" * 64,
            engine_version="hve-active-speaker-eval-v1",
            duration_ms=4_000,
            speaker_turns=[SpeakerTurn("speaker-a", 0, 2_000, 0.95)],
            mouth_windows=[MouthActivityWindow("face-a", 0, 2_000, 0.90, 0.96)],
            face_analysis_complete=True,
            diarization_engine="sherpa-onnx-eval",
            diarization_model_version="segmentation-1+embedding-1",
            diarization_artifact_sha256="b" * 64,
            mouth_engine="mediapipe-face-landmarker-eval",
            mouth_model_version="face-landmarker-1",
            mouth_artifact_sha256="c" * 64,
        )

        self.assertEqual(artifact["durationUs"], 4_000_000)
        self.assertEqual(artifact["activeSpeakerLinks"][0]["faceTrackId"], "face-a")
        self.assertEqual(artifact["activeSpeakerLinks"][0]["reason"], "audio_video_association")
        self.assertEqual(len(artifact["artifactHash"]), 64)
        self.assertNotIn("frame", artifact)
        self.assertNotIn("embedding", artifact)
        self.assertNotIn("landmarks", artifact)
        self.assertNotIn("audio", artifact)

    def test_compiles_only_matching_bounded_candidate_evidence(self):
        diarization = {
            "schemaVersion": 1,
            "sourceHash": "a" * 64,
            "durationMs": 4_000,
            "engine": "sherpa-onnx-eval",
            "modelVersion": "speaker-diarization-v1",
            "turns": [
                {"speakerId": "speaker-a", "startMs": 0, "endMs": 2_000, "confidence": 0.95},
                {"speakerId": "speaker-b", "startMs": 2_000, "endMs": 4_000, "confidence": 0.95},
            ],
        }
        mouth = {
            "schemaVersion": 1,
            "sourceHash": "a" * 64,
            "durationMs": 4_000,
            "engine": "mediapipe-face-landmarker-eval",
            "modelVersion": "face-landmarker-v1",
            "faceAnalysisComplete": True,
            "windows": [
                {"faceTrackId": "face-a", "startMs": 0, "endMs": 2_000, "activity": 0.92, "faceConfidence": 0.96},
                {"faceTrackId": "face-a", "startMs": 2_000, "endMs": 4_000, "activity": 0.05, "faceConfidence": 0.96},
                {"faceTrackId": "face-b", "startMs": 0, "endMs": 2_000, "activity": 0.05, "faceConfidence": 0.96},
                {"faceTrackId": "face-b", "startMs": 2_000, "endMs": 4_000, "activity": 0.92, "faceConfidence": 0.96},
            ],
        }

        artifact = compile_active_speaker_evidence(
            analysis_id="11111111-1111-4111-8111-111111111111",
            source_id="22222222-2222-4222-8222-222222222222",
            engine_version="hve-active-speaker-evaluator-v1",
            diarization_evidence=diarization,
            mouth_evidence=mouth,
        )

        self.assertEqual(artifact["activeSpeakerLinks"][0]["faceTrackId"], "face-a")
        self.assertEqual(artifact["activeSpeakerLinks"][1]["faceTrackId"], "face-b")
        self.assertEqual(len(artifact["provenance"]["diarization"]["artifactSha256"]), 64)
        self.assertNotIn("turns", artifact["provenance"])

    def test_rejects_raw_fields_from_candidate_evidence(self):
        diarization = {
            "schemaVersion": 1,
            "sourceHash": "a" * 64,
            "durationMs": 1_000,
            "engine": "candidate",
            "modelVersion": "v1",
            "turns": [],
            "embeddings": [],
        }
        mouth = {
            "schemaVersion": 1,
            "sourceHash": "b" * 64,
            "durationMs": 1_000,
            "engine": "candidate",
            "modelVersion": "v1",
            "faceAnalysisComplete": True,
            "windows": [],
        }
        with self.assertRaisesRegex(EvidenceValidationError, "invalid fields"):
            compile_active_speaker_evidence(
                analysis_id="11111111-1111-4111-8111-111111111111",
                source_id="22222222-2222-4222-8222-222222222222",
                engine_version="hve-active-speaker-evaluator-v1",
                diarization_evidence=diarization,
                mouth_evidence=mouth,
            )

    def test_rejects_mismatched_candidate_sources(self):
        diarization = {
            "schemaVersion": 1,
            "sourceHash": "a" * 64,
            "durationMs": 1_000,
            "engine": "candidate",
            "modelVersion": "v1",
            "turns": [],
        }
        mouth = {
            "schemaVersion": 1,
            "sourceHash": "b" * 64,
            "durationMs": 1_000,
            "engine": "candidate",
            "modelVersion": "v1",
            "faceAnalysisComplete": True,
            "windows": [],
        }
        with self.assertRaisesRegex(EvidenceValidationError, "same sourceHash"):
            compile_active_speaker_evidence(
                analysis_id="11111111-1111-4111-8111-111111111111",
                source_id="22222222-2222-4222-8222-222222222222",
                engine_version="hve-active-speaker-evaluator-v1",
                diarization_evidence=diarization,
                mouth_evidence=mouth,
            )


if __name__ == "__main__":
    unittest.main()
