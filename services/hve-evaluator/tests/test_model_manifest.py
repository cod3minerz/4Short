import hashlib
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from hve_evaluator.model_manifest import ModelManifestError, verify_evaluator_models


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_manifest(root: Path, models: list[dict]) -> Path:
    payload = {"schemaVersion": 1, "kind": "hve-evaluator-models-v1", "models": models}
    payload["fingerprint"] = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    destination = root / "models.json"
    destination.write_text(json.dumps(payload), encoding="utf-8")
    return destination


class EvaluatorModelManifestTests(unittest.TestCase):
    def _models(self, root: Path) -> list[dict]:
        records = []
        for model_id, kind in [
            ("segmentation", "sherpa_segmentation"),
            ("embedding", "sherpa_embedding"),
            ("face", "mediapipe_face_landmarker"),
        ]:
            path = root / f"{model_id}.bin"
            path.write_bytes(f"{model_id}-bytes".encode("utf-8"))
            records.append({
                "id": model_id,
                "kind": kind,
                "path": path.name,
                "sha256": _digest(path),
                "version": "candidate-v1",
                "licenseRef": "Apache-2.0",
                "sourceUrl": "https://models.example.test/candidate",
            })
        return records

    def test_verifies_complete_hashed_model_set(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = _write_manifest(root, self._models(root))
            verified = verify_evaluator_models(manifest_path=manifest, model_root=root)
            self.assertEqual(len(verified.models), 3)
            self.assertEqual(verified.require("sherpa_segmentation").model_id, "segmentation")
            self.assertEqual(len(verified.fingerprint), 64)

    def test_rejects_model_byte_substitution_after_manifest_creation(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            models = self._models(root)
            manifest = _write_manifest(root, models)
            (root / "face.bin").write_bytes(b"substituted")
            with self.assertRaisesRegex(ModelManifestError, "byte hash"):
                verify_evaluator_models(manifest_path=manifest, model_root=root)

    def test_rejects_unexpected_manifest_fields_and_path_escape(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            models = self._models(root)
            models[0]["path"] = "../outside.onnx"
            manifest = _write_manifest(root, models)
            with self.assertRaisesRegex(ModelManifestError, "relative path"):
                verify_evaluator_models(manifest_path=manifest, model_root=root)

            payload = json.loads(manifest.read_text("utf-8"))
            payload["unexpected"] = True
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ModelManifestError, "unexpected fields"):
                verify_evaluator_models(manifest_path=manifest, model_root=root)
