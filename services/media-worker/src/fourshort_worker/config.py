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

    s3_endpoint: str = "https://s3.twcstorage.ru"
    s3_region: str = "ru-1"
    s3_force_path_style: bool = True
    s3_server_side_encryption: str = "none"
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_bucket: str | None = None
    s3_raw_bucket: str = "4short-raw"
    s3_derived_bucket: str = "4short-derived"
    s3_raw_prefix: str = "raw"
    s3_derived_prefix: str = "derived"

    yandex_cloud_folder_id: str | None = None
    yandex_cloud_api_key: str | None = None
    stt_provider: str = "yandex_speechkit"
    stt_base_url: str | None = None
    stt_api_key: str | None = None
    stt_model: str | None = None

    llm_provider: str = "openrouter"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_candidate_model: str = "deepseek/deepseek-v4-flash"
    llm_rerank_model: str = "deepseek/deepseek-v4-pro"
    llm_allowed_models: str = "deepseek/deepseek-v4-flash,deepseek/deepseek-v4-pro"
    llm_blocked_model_prefixes: str = "openai/,anthropic/"
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"

    @property
    def memory_limit_bytes(self) -> int:
        return int(1.4 * 1024**3) if self.worker_mode == "2gb" else int(3 * 1024**3)

    @property
    def allowed_llm_models(self) -> set[str]:
        return {value.strip() for value in self.llm_allowed_models.split(",") if value.strip()}

    @property
    def blocked_llm_prefixes(self) -> tuple[str, ...]:
        return tuple(value.strip() for value in self.llm_blocked_model_prefixes.split(",") if value.strip())

    @property
    def effective_raw_bucket(self) -> str:
        return self.s3_bucket or self.s3_raw_bucket

    @property
    def effective_derived_bucket(self) -> str:
        return self.s3_bucket or self.s3_derived_bucket

    def object_key(self, kind: str, key: str) -> str:
        prefix = self.s3_raw_prefix if kind == "raw" else self.s3_derived_prefix
        normalized_prefix = prefix.strip("/")
        normalized_key = key.lstrip("/")
        return f"{normalized_prefix}/{normalized_key}" if normalized_prefix else normalized_key
