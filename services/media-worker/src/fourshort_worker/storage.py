from __future__ import annotations

import hashlib
import boto3
from boto3.exceptions import S3UploadFailedError
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from boto3.s3.transfer import TransferConfig
from pathlib import Path
from collections.abc import Callable

from .config import Settings
from .errors import JobError


def _storage_error(error: Exception, action: str) -> JobError:
    """Translate object-store faults into stable queue semantics.

    The worker must distinguish a temporary endpoint/timeout failure from a
    plan or access problem. Leaving these exceptions to the catch-all worker
    handler makes both cases look like an opaque ``UNHANDLED_WORKER_ERROR``
    and weakens retry/alert policy.
    """
    status_code: int | None = None
    provider_code: str | None = None
    if isinstance(error, ClientError):
        response = error.response if isinstance(error.response, dict) else {}
        metadata = response.get("ResponseMetadata") if isinstance(response.get("ResponseMetadata"), dict) else {}
        raw_status = metadata.get("HTTPStatusCode")
        status_code = raw_status if isinstance(raw_status, int) else None
        raw_code = response.get("Error", {}).get("Code") if isinstance(response.get("Error"), dict) else None
        provider_code = raw_code if isinstance(raw_code, str) else None

    retryable = not isinstance(error, ClientError) or status_code is None or status_code == 429 or status_code >= 500
    if retryable:
        return JobError(
            "S3_UNAVAILABLE",
            f"Object storage is temporarily unavailable during {action}",
            retryable=True,
            details={"action": action, "statusCode": status_code, "providerCode": provider_code},
        )
    if status_code == 404 or provider_code in {"NoSuchKey", "NoSuchBucket", "NotFound"}:
        return JobError(
            "S3_OBJECT_NOT_FOUND",
            f"Required object storage item is unavailable during {action}",
            retryable=False,
            details={"action": action, "statusCode": status_code, "providerCode": provider_code},
        )
    return JobError(
        "S3_ACCESS_OR_REQUEST_REJECTED",
        f"Object storage rejected {action}",
        retryable=False,
        details={"action": action, "statusCode": status_code, "providerCode": provider_code},
    )


class Storage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if settings.s3_force_path_style else "virtual"},
                retries={"max_attempts": 4, "mode": "adaptive"},
            ),
        )

    def _extra_args(self, content_type: str) -> dict:
        args = {"ContentType": content_type}
        if self.settings.s3_server_side_encryption == "AES256":
            args["ServerSideEncryption"] = "AES256"
        return args

    def signed_get(self, bucket: str, key: str, expires: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires,
        )

    def upload_file(self, path: Path, bucket: str, key: str, content_type: str) -> dict:
        # S3 ETags are not a content digest for multipart uploads. Every local
        # artifact we publish therefore carries a SHA-256 calculated before
        # upload; later package assembly can verify the exact persisted bytes.
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        try:
            self.client.upload_file(
                str(path),
                bucket,
                key,
                ExtraArgs=self._extra_args(content_type),
            )
            head = self.client.head_object(Bucket=bucket, Key=key)
        except (BotoCoreError, ClientError, S3UploadFailedError, OSError) as error:
            raise _storage_error(error, "upload") from error
        return {
            "bucket": bucket,
            "key": key,
            "byteSize": head["ContentLength"],
            "etag": head.get("ETag", "").strip('"'),
            "mimeType": content_type,
            "sha256": digest.hexdigest(),
        }

    def sha256_object(self, bucket: str, key: str) -> str:
        import hashlib
        digest = hashlib.sha256()
        try:
            response = self.client.get_object(Bucket=bucket, Key=key)
            for chunk in iter(lambda: response["Body"].read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        except (BotoCoreError, ClientError, S3UploadFailedError, OSError) as error:
            raise _storage_error(error, "checksum") from error
        return digest.hexdigest()

    def download_verified_file(
        self,
        bucket: str,
        key: str,
        destination: Path,
        *,
        expected_sha256: str,
        max_bytes: int,
    ) -> int:
        """Download a private render asset with a bounded, verified stream.

        Brand assets never arrive through a caller-controlled URL.  The worker
        reads the object with its own S3 credentials, enforces the size before
        and during streaming, and verifies the content hash from the resolved
        plan before FFmpeg can interpret the file.
        """
        digest = hashlib.sha256()
        total = 0
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            response = self.client.get_object(Bucket=bucket, Key=key)
            declared_size = response.get("ContentLength")
            if declared_size is not None and int(declared_size) > max_bytes:
                raise ValueError("HVE_STATIC_ASSET_TOO_LARGE")
            with destination.open("wb") as handle:
                for chunk in iter(lambda: response["Body"].read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError("HVE_STATIC_ASSET_TOO_LARGE")
                    digest.update(chunk)
                    handle.write(chunk)
        except (BotoCoreError, ClientError, S3UploadFailedError, OSError) as error:
            destination.unlink(missing_ok=True)
            raise _storage_error(error, "verified download") from error
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        if digest.hexdigest().lower() != expected_sha256.lower():
            destination.unlink(missing_ok=True)
            raise ValueError("HVE_STATIC_ASSET_HASH_MISMATCH")
        return total

    def download_bounded_file(
        self,
        bucket: str,
        key: str,
        destination: Path,
        *,
        expected_bytes: int,
        expected_sha256: str | None = None,
        max_bytes: int,
    ) -> int:
        """Copy a control-plane selected object with an exact size contract.

        ZIP manifests contain only database-owned bucket/key pairs. The exact
        object size is still checked before and during the stream, so a stale
        or replaced object cannot quietly exhaust worker scratch space.
        """
        if expected_bytes < 0 or expected_bytes > max_bytes:
            raise ValueError("HVE_PACKAGE_ARTIFACT_SIZE_INVALID")
        total = 0
        digest = hashlib.sha256() if expected_sha256 else None
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            response = self.client.get_object(Bucket=bucket, Key=key)
            declared_size = response.get("ContentLength")
            if declared_size is not None and int(declared_size) != expected_bytes:
                raise ValueError("HVE_PACKAGE_ARTIFACT_SIZE_MISMATCH")
            with destination.open("wb") as handle:
                for chunk in iter(lambda: response["Body"].read(1024 * 1024), b""):
                    total += len(chunk)
                    if total > max_bytes or total > expected_bytes:
                        raise ValueError("HVE_PACKAGE_ARTIFACT_SIZE_INVALID")
                    if digest is not None:
                        digest.update(chunk)
                    handle.write(chunk)
        except (BotoCoreError, ClientError, S3UploadFailedError, OSError) as error:
            destination.unlink(missing_ok=True)
            raise _storage_error(error, "bounded download") from error
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        if total != expected_bytes:
            destination.unlink(missing_ok=True)
            raise ValueError("HVE_PACKAGE_ARTIFACT_SIZE_MISMATCH")
        if digest is not None and digest.hexdigest().lower() != expected_sha256.lower():
            destination.unlink(missing_ok=True)
            raise ValueError("HVE_PACKAGE_ARTIFACT_HASH_MISMATCH")
        return total

    def upload_stream(
        self,
        stream,
        bucket: str,
        key: str,
        content_type: str,
        *,
        on_progress: Callable[[int], None] | None = None,
    ) -> dict:
        """Persist a streamed import and expose only measured transferred bytes.

        ``upload_fileobj`` invokes its callback after S3 has accepted a
        chunk. This makes the number user-visible progress instead of a
        guessed percentage based on an unknown remote source size.
        """
        uploaded_bytes = 0

        def report_transferred(chunk_bytes: int) -> None:
            nonlocal uploaded_bytes
            uploaded_bytes += int(chunk_bytes)
            if on_progress is not None:
                on_progress(uploaded_bytes)

        try:
            self.client.upload_fileobj(
                stream,
                bucket,
                key,
                ExtraArgs=self._extra_args(content_type),
                Config=TransferConfig(
                    multipart_threshold=16 * 1024**2,
                    multipart_chunksize=16 * 1024**2,
                    max_concurrency=1,
                    use_threads=False,
                ),
                Callback=report_transferred,
            )
            head = self.client.head_object(Bucket=bucket, Key=key)
        except (BotoCoreError, ClientError, S3UploadFailedError, OSError) as error:
            raise _storage_error(error, "stream upload") from error
        return {
            "bucket": bucket,
            "key": key,
            "byteSize": head["ContentLength"],
            "etag": head.get("ETag", "").strip('"'),
            "mimeType": content_type,
        }
