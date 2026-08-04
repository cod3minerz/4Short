import hashlib
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).parents[2] / "media-worker" / "src"))
sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.active_speaker_evidence import compile_active_speaker_evidence, evidence_sha256
from fourshort_worker import association as association_module
from hve_evaluator.prediction_bundle import PredictionBundleError, build_prediction_bundle


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


class PredictionBundleTests(unittest.TestCase):
    def _write_model_manifest(self, root: Path):
        models_root = root / "models"
        values = [
            ("segmentation", "sherpa_segmentation", "seg/model.onnx", b"segmentation"),
            ("embedding", "sherpa_embedding", "emb/model.onnx", b"embedding"),
            ("face", "mediapipe_face_landmarker", "face/model.task", b"face-landmarker"),
        ]
        records = []
        for model_id, kind, relative, payload in values:
            path = models_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            records.append({
                "id": model_id,
                "kind": kind,
                "path": relative,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "version": f"{model_id}-v1",
                "licenseRef": "private-evaluator-review",
                "sourceUrl": f"https://example.invalid/models/{model_id}-v1",
            })
        payload = {"schemaVersion": 1, "kind": "hve-evaluator-models-v1", "models": records}
        manifest = {**payload, "fingerprint": digest(payload)}
        path = models_root / "models.json"
        path.write_text(canonical(manifest), encoding="utf-8")
        return models_root, path, manifest

    def _write_candidate(self, root: Path, source_hash: str, manifest_fingerprint: str):
        output = root / "candidates" / "item-1"
        output.mkdir(parents=True)
        diarization = {
            "schemaVersion": 1, "sourceHash": source_hash, "durationMs": 4_000,
            "engine": "sherpa-onnx-offline-diarization", "modelVersion": "sherpa-1:seg-v1+emb-v1",
            "turns": [{"speakerId": "s0", "startMs": 0, "endMs": 4_000, "confidence": 0.95}],
        }
        mouth = {
            "schemaVersion": 1, "sourceHash": source_hash, "durationMs": 4_000,
            "engine": "mediapipe-face-landmarker-video", "modelVersion": "mediapipe-1:face-v1",
            "faceAnalysisComplete": True,
            "windows": [{"faceTrackId": "face-0", "startMs": 0, "endMs": 4_000, "activity": 0.95, "faceConfidence": 0.95}],
        }
        artifact = compile_active_speaker_evidence(
            analysis_id="11111111-1111-4111-8111-111111111111",
            source_id="22222222-2222-4222-8222-222222222222",
            engine_version="hve-active-speaker-candidate-v1",
            diarization_evidence=diarization,
            mouth_evidence=mouth,
        )
        association = Path(association_module.__file__).resolve()
        run = {
            "schemaVersion": 1,
            "kind": "hve-active-speaker-candidate-run-v1",
            "sourceHash": source_hash,
            "durationMs": 4_000,
            "modelManifestFingerprint": manifest_fingerprint,
            "diarizationEvidenceSha256": evidence_sha256(diarization),
            "mouthEvidenceSha256": evidence_sha256(mouth),
            "activeSpeakerArtifactSha256": artifact["artifactHash"],
            "associationCodeSha256": hashlib.sha256(association.read_bytes()).hexdigest(),
            "measurement": {
                "scope": "cgroup-v2",
                "peakRssBytes": 1_000_000,
                "sustainedSwapBytes": 0,
                "wallSeconds": 4.5,
                "mediaSeconds": 4.0,
                "coldStartSeconds": 0.2,
            },
        }
        for name, value in [("diarization.json", diarization), ("mouth-activity.json", mouth), ("active-speaker-artifact.json", artifact), ("candidate-run.json", run)]:
            (output / name).write_text(canonical(value), encoding="utf-8")
        return output

    def _build(self, root: Path):
        models_root, model_manifest, manifest = self._write_model_manifest(root)
        source_hash = "a" * 64
        self._write_candidate(root, source_hash, manifest["fingerprint"])
        mapping = {
            "schemaVersion": 1,
            "kind": "hve-active-speaker-evaluator-mappings-v1",
            "items": [{
                "itemId": "item-001",
                "sourceHash": source_hash,
                "candidateOutput": "item-1",
                "speakers": {"s0": "gold-speaker-a"},
                "faces": {"face-0": "gold-face-a"},
            }],
        }
        mapping_path = root / "mapping.json"
        mapping_path.write_text(canonical(mapping), encoding="utf-8")
        hardware_path = root / "hardware.json"
        hardware_path.write_text(canonical({"profile": "timeweb-cpu8-12gb", "cpuCount": 8, "memoryBytes": 12 * 1024 ** 3}), encoding="utf-8")
        association = Path(association_module.__file__).resolve()
        return build_prediction_bundle(
            mapping_path=mapping_path,
            candidate_root=root / "candidates",
            models_manifest=model_manifest,
            model_root=models_root,
            corpus_version="hve-g5-development-v1",
            manifest_sha256="b" * 64,
            object_index_sha256="c" * 64,
            evaluator_key_fingerprint="d" * 64,
            hardware_path=hardware_path,
            association_code_path=association,
        )

    def test_builds_evidence_bound_unsigned_prediction_bundle(self):
        with TemporaryDirectory() as directory:
            bundle = self._build(Path(directory))
        self.assertEqual(bundle["kind"], "hve-active-speaker-predictions-v1")
        self.assertEqual(bundle["items"][0]["links"][0]["faceTrackId"], "face-0")
        self.assertEqual(bundle["items"][0]["measurement"]["sustainedSwapBytes"], 0.0)
        self.assertEqual(bundle["candidate"]["diarizationEngine"], "sherpa-onnx-offline-diarization")

    def test_rejects_process_only_measurement_as_promotion_evidence(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self._build(root)
            candidate_run = root / "candidates" / "item-1" / "candidate-run.json"
            value = json.loads(candidate_run.read_text("utf-8"))
            value["measurement"]["scope"] = "process-fallback"
            candidate_run.write_text(canonical(value), encoding="utf-8")
            with self.assertRaisesRegex(PredictionBundleError, "cgroup-v2"):
                self._build_reusing_existing(root)

    def test_rejects_raw_evidence_substitution_after_candidate_completion(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self._build(root)
            evidence_path = root / "candidates" / "item-1" / "mouth-activity.json"
            evidence = json.loads(evidence_path.read_text("utf-8"))
            evidence["windows"][0]["activity"] = 0.01
            evidence_path.write_text(canonical(evidence), encoding="utf-8")
            with self.assertRaisesRegex(PredictionBundleError, "mouth evidence bytes"):
                self._build_reusing_existing(root)

    def test_rejects_association_code_substitution(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self._build(root)
            models_root = root / "models"
            manifest = json.loads((models_root / "models.json").read_text("utf-8"))
            fake_association = root / "association.py"
            fake_association.write_text("tampered evaluator code", encoding="utf-8")
            with self.assertRaisesRegex(PredictionBundleError, "association-code hash"):
                # The helper below explicitly provides the real association path;
                # construct a second call with the tampered one to prove the
                # candidate folder cannot silently switch implementation.
                build_prediction_bundle(
                    mapping_path=root / "mapping.json",
                    candidate_root=root / "candidates",
                    models_manifest=models_root / "models.json",
                    model_root=models_root,
                    corpus_version="hve-g5-development-v1",
                    manifest_sha256="b" * 64,
                    object_index_sha256="c" * 64,
                    evaluator_key_fingerprint="d" * 64,
                    hardware_path=root / "hardware.json",
                    association_code_path=fake_association,
                )

    def _build_reusing_existing(self, root: Path):
        models_root = root / "models"
        manifest = json.loads((models_root / "models.json").read_text("utf-8"))
        mapping_path = root / "mapping.json"
        hardware_path = root / "hardware.json"
        association = Path(association_module.__file__).resolve()
        return build_prediction_bundle(
            mapping_path=mapping_path,
            candidate_root=root / "candidates",
            models_manifest=models_root / "models.json",
            model_root=models_root,
            corpus_version="hve-g5-development-v1",
            manifest_sha256="b" * 64,
            object_index_sha256="c" * 64,
            evaluator_key_fingerprint="d" * 64,
            hardware_path=hardware_path,
            association_code_path=association,
        )
