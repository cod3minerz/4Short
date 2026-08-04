import sys
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.errors import JobError
from fourshort_worker.model_assets import (
    MODEL_MANIFEST_NAME,
    _verify_face_detector,
    verify_face_detector_model,
    verify_local_stt_model,
    write_model_manifest,
)


class LocalWhisperModelTests(unittest.TestCase):
    def create_pack(self, root: Path) -> tuple[Path, str]:
        model = root / "large-v3-turbo"
        model.mkdir()
        for name, payload in {
            "config.json": b'{"model": "ct2"}',
            "model.bin": b"model-weights",
            "tokenizer.json": b'{"tokenizer": true}',
            "vocabulary.txt": b"hello\\n",
        }.items():
            (model / name).write_bytes(payload)
        fingerprint = write_model_manifest(
            model,
            model="large-v3-turbo",
            source="Systran/faster-whisper-large-v3-turbo",
            revision="0123456789abcdef0123456789abcdef01234567",
        )
        return model, fingerprint

    def settings(self, model: Path, fingerprint: str):
        return SimpleNamespace(
            stt_model_path=model,
            stt_model_manifest=None,
            stt_model="large-v3-turbo",
            stt_model_fingerprint=fingerprint,
        )

    def test_accepts_a_complete_verified_local_pack(self):
        with TemporaryDirectory() as directory:
            model, fingerprint = self.create_pack(Path(directory))
            verified = verify_local_stt_model(self.settings(model, fingerprint))
            self.assertEqual(verified.path, model)
            self.assertEqual(verified.fingerprint, fingerprint)

    def test_rejects_changed_model_bytes_even_when_manifest_exists(self):
        with TemporaryDirectory() as directory:
            model, fingerprint = self.create_pack(Path(directory))
            (model / "model.bin").write_bytes(b"not-the-signed-model")
            with self.assertRaises(JobError) as context:
                verify_local_stt_model(self.settings(model, fingerprint))
            self.assertEqual(context.exception.code, "STT_MODEL_TAMPERED")

    def test_rejects_an_unpinned_fingerprint(self):
        with TemporaryDirectory() as directory:
            model, _fingerprint = self.create_pack(Path(directory))
            with self.assertRaises(JobError) as context:
                verify_local_stt_model(self.settings(model, "another-fingerprint"))
            self.assertEqual(context.exception.code, "STT_MODEL_FINGERPRINT_MISMATCH")

    def test_rejects_unmanifested_model_files(self):
        with TemporaryDirectory() as directory:
            model, fingerprint = self.create_pack(Path(directory))
            (model / "unexpected.bin").write_bytes(b"must-not-be-silently-loaded")
            with self.assertRaises(JobError) as context:
                verify_local_stt_model(self.settings(model, fingerprint))
            self.assertEqual(context.exception.code, "STT_MODEL_TAMPERED")

    def test_manifest_fingerprint_is_content_addressed(self):
        with TemporaryDirectory() as directory:
            model, fingerprint = self.create_pack(Path(directory))
            manifest = json.loads((model / MODEL_MANIFEST_NAME).read_text(encoding="utf-8"))
            canonical = {key: manifest[key] for key in ("schemaVersion", "model", "source", "revision", "files")}
            expected = sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
            self.assertEqual(fingerprint, expected)


class FaceDetectorAssetTests(unittest.TestCase):
    def setUp(self):
        _verify_face_detector.cache_clear()

    def tearDown(self):
        _verify_face_detector.cache_clear()

    def test_face_detector_requires_the_exact_pinned_checksum(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "yunet.onnx"
            path.write_bytes(b"pinned-yunet")
            fingerprint = sha256(path.read_bytes()).hexdigest()
            settings = SimpleNamespace(face_detector_model=path, face_detector_fingerprint=fingerprint)
            verified = verify_face_detector_model(settings)
            self.assertEqual(verified.path, path)
            self.assertEqual(verified.fingerprint, fingerprint)

    def test_face_detector_rejects_tampering_and_missing_fingerprint(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "yunet.onnx"
            path.write_bytes(b"original")
            fingerprint = sha256(path.read_bytes()).hexdigest()
            path.write_bytes(b"changed")
            with self.assertRaises(JobError) as changed:
                verify_face_detector_model(SimpleNamespace(face_detector_model=path, face_detector_fingerprint=fingerprint))
            self.assertEqual(changed.exception.code, "FACE_MODEL_TAMPERED")
            _verify_face_detector.cache_clear()
            with self.assertRaises(JobError) as missing:
                verify_face_detector_model(SimpleNamespace(face_detector_model=path, face_detector_fingerprint=""))
            self.assertEqual(missing.exception.code, "FACE_MODEL_FINGERPRINT_MISSING")


if __name__ == "__main__":
    unittest.main()
