from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    control_api_url: str = "http://127.0.0.1:4100"
    worker_api_token: str
    worker_id: str = "worker-local-1"
    worker_mode: str = "4gb"
    scratch_root: Path = Path("/var/lib/4short/jobs")
    minimum_scratch_free_bytes: int = 8 * 1024**3
    poll_seconds: float = 2.0
    lease_seconds: int = 120
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    ytdlp_path: str = "yt-dlp"

    s3_endpoint: str = "https://storage.yandexcloud.net"
    s3_region: str = "ru-central1"
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_raw_bucket: str = "4short-raw"
    s3_derived_bucket: str = "4short-derived"

    yandex_cloud_folder_id: str | None = None
    yandex_cloud_api_key: str | None = None

    @property
    def memory_limit_bytes(self) -> int:
        return int(1.4 * 1024**3) if self.worker_mode == "2gb" else int(3 * 1024**3)
