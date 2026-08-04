import io
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from boto3.exceptions import S3UploadFailedError
from botocore.exceptions import ClientError, EndpointConnectionError

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.errors import JobError
from fourshort_worker.storage import Storage


class FailingStorageClient:
    def __init__(self, error):
        self.error = error

    def get_object(self, **_kwargs):
        raise self.error

    def upload_file(self, *_args, **_kwargs):
        raise self.error

    def upload_fileobj(self, *_args, **_kwargs):
        raise self.error


def storage_with(error):
    storage = object.__new__(Storage)
    storage.client = FailingStorageClient(error)
    storage.settings = type("Settings", (), {"s3_server_side_encryption": "none"})()
    return storage


class StorageFailureTests(unittest.TestCase):
    def test_endpoint_timeout_is_a_retryable_storage_failure_and_leaves_no_partial_file(self):
        storage = storage_with(EndpointConnectionError(endpoint_url="https://s3.example.invalid"))
        with TemporaryDirectory() as directory:
            destination = Path(directory) / "asset.bin"
            with self.assertRaises(JobError) as context:
                storage.download_verified_file(
                    "bucket", "key", destination,
                    expected_sha256="a" * 64,
                    max_bytes=1024,
                )
            self.assertEqual(context.exception.code, "S3_UNAVAILABLE")
            self.assertTrue(context.exception.retryable)
            self.assertFalse(destination.exists())

    def test_missing_object_is_not_retried_forever(self):
        missing = ClientError(
            {"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
            "GetObject",
        )
        storage = storage_with(missing)
        with TemporaryDirectory() as directory:
            with self.assertRaises(JobError) as context:
                storage.download_bounded_file(
                    "bucket", "key", Path(directory) / "clip.mp4",
                    expected_bytes=100,
                    max_bytes=1024,
                )
        self.assertEqual(context.exception.code, "S3_OBJECT_NOT_FOUND")
        self.assertFalse(context.exception.retryable)

    def test_stream_upload_timeout_is_retryable(self):
        storage = storage_with(EndpointConnectionError(endpoint_url="https://s3.example.invalid"))
        with self.assertRaises(JobError) as context:
            storage.upload_stream(io.BytesIO(b"fixture"), "bucket", "key", "video/mp4")
        self.assertEqual(context.exception.code, "S3_UNAVAILABLE")
        self.assertTrue(context.exception.retryable)

    def test_multipart_upload_failure_is_retryable(self):
        storage = storage_with(S3UploadFailedError("simulated multipart failure"))
        with TemporaryDirectory() as directory:
            source = Path(directory) / "render.mp4"
            source.write_bytes(b"fixture")
            with self.assertRaises(JobError) as context:
                storage.upload_file(source, "bucket", "key", "video/mp4")
        self.assertEqual(context.exception.code, "S3_UNAVAILABLE")
        self.assertTrue(context.exception.retryable)


if __name__ == "__main__":
    unittest.main()
