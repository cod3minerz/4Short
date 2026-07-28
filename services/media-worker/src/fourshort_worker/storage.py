from __future__ import annotations

import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
from pathlib import Path

from .config import Settings


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
        self.client.upload_file(
            str(path),
            bucket,
            key,
            ExtraArgs=self._extra_args(content_type),
        )
        head = self.client.head_object(Bucket=bucket, Key=key)
        return {
            "bucket": bucket,
            "key": key,
            "byteSize": head["ContentLength"],
            "etag": head.get("ETag", "").strip('"'),
            "mimeType": content_type,
        }

    def sha256_object(self, bucket: str, key: str) -> str:
        import hashlib
        digest = hashlib.sha256()
        response = self.client.get_object(Bucket=bucket, Key=key)
        for chunk in iter(lambda: response["Body"].read(8 * 1024 * 1024), b""):
            digest.update(chunk)
        return digest.hexdigest()

    def upload_stream(self, stream, bucket: str, key: str, content_type: str) -> dict:
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
        )
        head = self.client.head_object(Bucket=bucket, Key=key)
        return {
            "bucket": bucket,
            "key": key,
            "byteSize": head["ContentLength"],
            "etag": head.get("ETag", "").strip('"'),
            "mimeType": content_type,
        }
