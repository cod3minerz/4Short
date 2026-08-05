from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    control_api_url: str = "http://127.0.0.1:4100"
    worker_api_token: str
    worker_id: str = "worker-local-1"
    worker_version: str = "0.2.0"
    hve_engine_version: str = "hve-0.1"
    hve_planner_version: str = "hve-planner-v2.0"
    # Includes the deterministic libass font pack installed by the image.
    # Change it with every renderer or font-pack change to invalidate cached
    # artifacts safely.
    hve_renderer_version: str = "hve-renderer-v2-font-pack-1"
    worker_mode: str = "12gb"
    scratch_root: Path = Path("/var/lib/4short/jobs")
    health_file: Path = Path("/tmp/4short-worker-ready")
    # A deploy/operator-created marker drains this worker without killing an
    # active customer job. It is deliberately local to the worker volume: a
    # benchmark or maintenance window should not need a privileged database
    # mutation or a control-plane restart.
    # The container root filesystem is intentionally read-only.  Keep mutable
    # coordination markers in the dedicated writable job volume instead of
    # `/var/lib/4short` itself.
    drain_file: Path = Path("/var/lib/4short/jobs/worker-drain")
    active_job_file: Path = Path("/var/lib/4short/jobs/worker-active-job.json")
    # A 100 GB NVMe worker must retain enough scratch for the active job and
    # one safe retry.  Below 20 GB heavy jobs wait; below 12 GB nothing starts.
    minimum_scratch_free_bytes: int = 12 * 1024**3
    scratch_throttle_free_bytes: int = 20 * 1024**3
    minimum_available_memory_bytes: int = 1_500 * 1024**2
    # Project packages are assembled only from already validated render
    # artifacts. Keep a hard bound below the 100 GB worker disk so a single
    # request cannot evict scratch space required by the render queue.
    package_max_bytes: int = 8 * 1024**3
    package_max_artifacts: int = 600
    poll_seconds: float = 2.0
    lease_seconds: int = 120
    heartbeat_seconds: int = 30
    registration_seconds: int = 30
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    ytdlp_path: str = "yt-dlp"
    # Prefer the bounded external downloader when the immutable worker image
    # provides it. aria2c opens safe parallel HTTP ranges for normal
    # progressive MP4s — the case where yt-dlp fragment concurrency cannot
    # help. The importer checks availability before passing this value on.
    ytdlp_external_downloader: str = "aria2c"
    source_import_max_bytes: int = 10 * 1024 * 1024 * 1024
    # The worker deliberately processes one media job at a time.  Bound each
    # FFmpeg invocation as well: otherwise filter/encoder auto-threading can
    # consume the entire host and invalidate queue capacity assumptions.
    ffmpeg_threads: int = 4

    s3_endpoint: str = "https://s3.twcstorage.ru"
    s3_region: str = "ru-1"
    s3_force_path_style: bool = True
    s3_server_side_encryption: str = "none"
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_bucket: str | None = None
    s3_raw_bucket: str = "4short-raw"
    s3_proxy_bucket: str = "4short-proxy"
    s3_derived_bucket: str = "4short-derived"
    s3_raw_prefix: str = "raw"
    s3_proxy_prefix: str = "proxy"
    s3_derived_prefix: str = "derived"

    # A HVE worker uses a pre-provisioned local CTranslate2 model pack. It may
    # never receive a Hugging Face model name here, because that would allow a
    # customer job to trigger an unbounded network download.
    stt_model: str = "large-v3-turbo"
    stt_model_path: Path = Path("/var/lib/4short/models/large-v3-turbo")
    stt_model_manifest: Path | None = None
    # This is the manifest fingerprint emitted by the explicit provisioning
    # step and stored as a deployment secret. An empty value is not accepted
    # for transcription.
    stt_model_fingerprint: str | None = None
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    stt_cpu_threads: int = 8
    stt_num_workers: int = 1
    stt_beam_size: int = 5
    stt_vad_filter: bool = True
    stt_vad_min_silence_ms: int = 500
    stt_vad_speech_pad_ms: int = 120

    face_tracking_enabled: bool = True
    face_detector_model: Path = Path("/opt/4short/models/face_detection_yunet_2023mar_int8.onnx")
    face_detector_fingerprint: str | None = None
    face_detector_score_threshold: float = 0.82
    face_sample_fps: float = 3.0
    face_detector_max_width: int = 640
    face_track_smoothing: float = 0.82
    # Sparse source perception is deliberately cheaper than clip-level
    # tracking. Dense analysis is only allowed later for selected clips.
    vision_source_sample_fps: float = 0.5
    vision_source_max_samples: int = 8_000
    # A dense pass is explicitly scoped to one selected clip range.  It never
    # upgrades source-wide perception implicitly or blocks initial analysis.
    vision_clip_sample_fps: float = 3.0
    vision_clip_max_samples: int = 1_500
    vision_scene_cut_threshold: float = 0.34

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
        limits = {
            "2gb": 1.4,
            "4gb": 3.0,
            "8gb": 6.5,
            "12gb": 10.0,
        }
        return int(limits.get(self.worker_mode, 3.0) * 1024**3)

    @property
    def effective_heartbeat_seconds(self) -> int:
        return max(5, min(self.heartbeat_seconds, self.lease_seconds // 3))

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

    @property
    def effective_proxy_bucket(self) -> str:
        return self.s3_bucket or self.s3_proxy_bucket

    def object_key(self, kind: str, key: str) -> str:
        prefixes = {
            "raw": self.s3_raw_prefix,
            "proxy": self.s3_proxy_prefix,
            "derived": self.s3_derived_prefix,
        }
        if kind not in prefixes:
            raise ValueError(f"Unsupported object kind: {kind}")
        prefix = prefixes[kind]
        normalized_prefix = prefix.strip("/")
        normalized_key = key.lstrip("/")
        return f"{normalized_prefix}/{normalized_key}" if normalized_prefix else normalized_key
