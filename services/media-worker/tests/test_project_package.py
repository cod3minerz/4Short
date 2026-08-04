import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.control_api import Job
from fourshort_worker.errors import JobError
from fourshort_worker.stages import StageRunner


class PackageStorage:
    def __init__(self, objects):
        self.objects = objects
        self.uploads = []

    def download_bounded_file(self, bucket, key, destination, *, expected_bytes, expected_sha256=None, max_bytes):
        value = self.objects[(bucket, key)]
        if len(value) != expected_bytes or expected_bytes > max_bytes:
            raise ValueError("HVE_PACKAGE_ARTIFACT_SIZE_MISMATCH")
        if expected_sha256 and __import__("hashlib").sha256(value).hexdigest() != expected_sha256:
            raise ValueError("HVE_PACKAGE_ARTIFACT_HASH_MISMATCH")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(value)
        return len(value)

    def upload_file(self, path, bucket, key, content_type):
        value = path.read_bytes()
        self.uploads.append((bucket, key, content_type, value))
        return {"bucket": bucket, "key": key, "byteSize": len(value), "mimeType": content_type}


class ProjectPackageTests(unittest.TestCase):
    def _settings(self):
        return SimpleNamespace(
            package_max_bytes=10_000_000,
            package_max_artifacts=20,
            effective_derived_bucket="derived",
            object_key=lambda kind, key: f"derived/{key}",
        )

    def _job(self, items):
        return Job(
            id="11111111-1111-1111-1111-111111111111",
            workspace_id="workspace-1",
            project_id="project-1",
            clip_id=None,
            type="zip_project",
            job_class="io",
            payload={
                "packageId": "22222222-2222-2222-2222-222222222222",
                "manifestHash": "a" * 64,
                "items": items,
            },
            attempt_count=1,
        )

    def test_zip_project_exports_only_manifest_artifacts_with_safe_names(self):
        objects = {
            ("derived", "clip-1.mp4"): b"mp4-bytes",
            ("derived", "clip-1.srt"): b"1\ncaption\n",
            ("derived", "clip-1.vtt"): b"WEBVTT\n",
        }
        storage = PackageStorage(objects)
        runner = StageRunner(self._settings(), storage)
        items = [{
            "clipId": "33333333-3333-3333-3333-333333333333",
            "title": "Ролик / ../../ нельзя",
            "artifacts": [
                {"kind": "mp4", "bucket": "derived", "key": "clip-1.mp4", "byteSize": len(objects[("derived", "clip-1.mp4")])},
                {"kind": "srt", "bucket": "derived", "key": "clip-1.srt", "byteSize": len(objects[("derived", "clip-1.srt")])},
                {"kind": "vtt", "bucket": "derived", "key": "clip-1.vtt", "byteSize": len(objects[("derived", "clip-1.vtt")])},
            ],
        }]
        with tempfile.TemporaryDirectory() as directory:
            result = runner.zip_project(self._job(items), Path(directory))
        self.assertEqual(result["itemCount"], 1)
        self.assertEqual(result["artifactCount"], 3)
        self.assertEqual(len(storage.uploads), 1)
        uploaded = storage.uploads[0]
        self.assertEqual(uploaded[2], "application/zip")
        with tempfile.NamedTemporaryFile(suffix=".zip") as archive_file:
            archive_file.write(uploaded[3])
            archive_file.flush()
            with zipfile.ZipFile(archive_file.name) as archive:
                self.assertEqual(archive.namelist(), [
                    "clips/001-Ролик-нельзя/mp4.mp4",
                    "clips/001-Ролик-нельзя/srt.srt",
                    "clips/001-Ролик-нельзя/vtt.vtt",
                ])
                self.assertEqual(archive.read("clips/001-Ролик-нельзя/srt.srt"), b"1\ncaption\n")

    def test_zip_project_rejects_item_without_mp4(self):
        runner = StageRunner(self._settings(), PackageStorage({}))
        items = [{
            "clipId": "33333333-3333-3333-3333-333333333333",
            "artifacts": [{"kind": "srt", "bucket": "derived", "key": "clip-1.srt", "byteSize": 1}],
        }]
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(JobError) as raised:
                runner.zip_project(self._job(items), Path(directory))
        self.assertEqual(raised.exception.code, "HVE_PACKAGE_VIDEO_REQUIRED")

    def test_zip_project_rejects_hash_mismatch_before_publishing_archive(self):
        objects = {("derived", "clip-1.mp4"): b"mp4-bytes"}
        runner = StageRunner(self._settings(), PackageStorage(objects))
        items = [{
            "clipId": "33333333-3333-3333-3333-333333333333",
            "artifacts": [{
                "kind": "mp4", "bucket": "derived", "key": "clip-1.mp4",
                "byteSize": len(objects[("derived", "clip-1.mp4")]), "sha256": "a" * 64,
            }],
        }]
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(JobError) as raised:
                runner.zip_project(self._job(items), Path(directory))
        self.assertEqual(raised.exception.code, "HVE_PACKAGE_ARTIFACT_INVALID")

    def test_zip_project_requires_enough_scratch_for_members_and_archive(self):
        objects = {("derived", "clip-1.mp4"): b"x" * 1024}
        settings = self._settings()
        runner = StageRunner(settings, PackageStorage(objects))
        items = [{
            "clipId": "33333333-3333-3333-3333-333333333333",
            "artifacts": [{"kind": "mp4", "bucket": "derived", "key": "clip-1.mp4", "byteSize": 1024}],
        }]
        with tempfile.TemporaryDirectory() as directory:
            # The required amount is twice the artifact size plus metadata.
            # Patch only the filesystem observation, not the package path.
            with patch("fourshort_worker.stages.shutil.disk_usage", return_value=SimpleNamespace(free=1_000)):
                with self.assertRaises(JobError) as raised:
                    runner.zip_project(self._job(items), Path(directory))
        self.assertEqual(raised.exception.code, "HVE_PACKAGE_SCRATCH_INSUFFICIENT")


if __name__ == "__main__":
    unittest.main()
