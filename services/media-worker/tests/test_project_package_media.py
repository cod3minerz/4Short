"""Actual-media smoke for the HVE project package stage.

This is intentionally tiny, reproducible and independent of S3. It proves a
real H.264 object can enter the package, retain its bytes and fully decode
after extraction. Corpus-quality review remains a separate HVE-G3 gate.
"""

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.control_api import Job
from fourshort_worker.stages import StageRunner


class MemoryStorage:
    def __init__(self, objects):
        self.objects = objects
        self.uploaded = None

    def download_bounded_file(self, bucket, key, destination, *, expected_bytes, expected_sha256=None, max_bytes):
        value = self.objects[(bucket, key)]
        if len(value) != expected_bytes or len(value) > max_bytes:
            raise ValueError("HVE_PACKAGE_ARTIFACT_SIZE_MISMATCH")
        if expected_sha256 and hashlib.sha256(value).hexdigest() != expected_sha256:
            raise ValueError("HVE_PACKAGE_ARTIFACT_HASH_MISMATCH")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(value)
        return len(value)

    def upload_file(self, path, bucket, key, content_type):
        value = path.read_bytes()
        self.uploaded = value
        return {
            "bucket": bucket,
            "key": key,
            "byteSize": len(value),
            "mimeType": content_type,
            "sha256": hashlib.sha256(value).hexdigest(),
        }


class ProjectPackageMediaSmoke(unittest.TestCase):
    def test_real_h264_survives_packaging_and_full_decode(self):
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            self.skipTest("FFmpeg is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "fixture.mp4"
            generated = subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "color=c=0x0eb5ed:s=64x64:d=0.4:r=24",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(source),
            ], capture_output=True, text=True, check=False)
            if generated.returncode != 0:
                self.skipTest(f"H.264 fixture encoder is unavailable: {generated.stderr[-300:]}")
            mp4 = source.read_bytes()
            srt = b"1\n00:00:00,000 --> 00:00:00,300\nHello\n"
            objects = {("derived", "clip.mp4"): mp4, ("derived", "clip.srt"): srt}
            storage = MemoryStorage(objects)
            settings = SimpleNamespace(
                package_max_bytes=10_000_000,
                package_max_artifacts=10,
                effective_derived_bucket="derived",
                object_key=lambda kind, key: f"derived/{key}",
            )
            job = Job(
                id="11111111-1111-1111-1111-111111111111",
                workspace_id="workspace-1",
                project_id="project-1",
                clip_id=None,
                type="zip_project",
                job_class="io",
                payload={
                    "packageId": "22222222-2222-2222-2222-222222222222",
                    "manifestHash": "a" * 64,
                    "items": [{
                        "clipId": "33333333-3333-3333-3333-333333333333",
                        "title": "H.264 smoke",
                        "artifacts": [
                            {"kind": "mp4", "bucket": "derived", "key": "clip.mp4", "byteSize": len(mp4), "sha256": hashlib.sha256(mp4).hexdigest()},
                            {"kind": "srt", "bucket": "derived", "key": "clip.srt", "byteSize": len(srt), "sha256": hashlib.sha256(srt).hexdigest()},
                        ],
                    }],
                },
                attempt_count=1,
            )
            result = StageRunner(settings, storage).zip_project(job, root / "job")
            self.assertEqual(result["artifactCount"], 2)
            assert storage.uploaded is not None
            archive_path = root / "package.zip"
            archive_path.write_bytes(storage.uploaded)
            with zipfile.ZipFile(archive_path) as archive:
                member = "clips/001-H.264-smoke/mp4.mp4"
                extracted = root / "extracted.mp4"
                extracted.write_bytes(archive.read(member))
            probe = subprocess.run([
                "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name",
                "-of", "json", str(extracted),
            ], capture_output=True, text=True, check=False)
            self.assertEqual(probe.returncode, 0, probe.stderr)
            self.assertIn('\"codec_name\": \"h264\"', probe.stdout)
            decoded = subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(extracted),
                "-f", "null", "-",
            ], capture_output=True, text=True, check=False)
            self.assertEqual(decoded.returncode, 0, decoded.stderr)


if __name__ == "__main__":
    unittest.main()
