from __future__ import annotations

from pathlib import Path
import shutil
import psutil

from .config import Settings
from .errors import JobError


class ResourceGuard:
    def __init__(self, settings: Settings):
        self.settings = settings

    def assert_can_start(self, job_class: str) -> None:
        self.settings.scratch_root.mkdir(parents=True, exist_ok=True)
        disk = shutil.disk_usage(self.settings.scratch_root)
        if disk.free < self.settings.minimum_scratch_free_bytes:
            raise JobError(
                "SCRATCH_SPACE_LOW",
                "Not enough scratch disk space",
                retryable=True,
                details={"freeBytes": disk.free},
            )
        memory = psutil.virtual_memory()
        if job_class in {"cpu_light", "cpu_heavy"} and memory.available < 512 * 1024**2:
            raise JobError(
                "MEMORY_PRESSURE",
                "Worker is under memory pressure",
                retryable=True,
                details={"availableBytes": memory.available},
            )

    def job_dir(self, job_id: str) -> Path:
        if not job_id.replace("-", "").isalnum():
            raise JobError("INVALID_JOB_ID", "Invalid job id", retryable=False)
        path = (self.settings.scratch_root / job_id).resolve()
        if self.settings.scratch_root.resolve() not in path.parents:
            raise JobError("INVALID_JOB_PATH", "Invalid job path", retryable=False)
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        return path

    def cleanup(self, job_id: str) -> None:
        path = (self.settings.scratch_root / job_id).resolve()
        if path.exists() and self.settings.scratch_root.resolve() in path.parents:
            shutil.rmtree(path)
