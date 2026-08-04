from __future__ import annotations

from pathlib import Path
import shutil
import threading
import time
import psutil

from .config import Settings
from .errors import JobError


def _cgroup_v2_memory_values(
    *,
    cgroup_root: Path = Path("/sys/fs/cgroup"),
    proc_cgroup: Path = Path("/proc/self/cgroup"),
) -> tuple[int, int] | None:
    """Return ``(limit, current)`` for a finite cgroup-v2 memory bound."""
    try:
        relative_path = None
        for line in proc_cgroup.read_text(encoding="utf-8").splitlines():
            hierarchy, controllers, path = line.split(":", 2)
            if hierarchy == "0" and controllers == "":
                relative_path = path.lstrip("/")
                break
        if relative_path is None:
            return None
        directory = (cgroup_root / relative_path).resolve()
        if cgroup_root.resolve() != directory and cgroup_root.resolve() not in directory.parents:
            return None
        maximum = (directory / "memory.max").read_text(encoding="utf-8").strip()
        current = int((directory / "memory.current").read_text(encoding="utf-8").strip())
        if maximum == "max":
            return None
        return int(maximum), current
    except (OSError, ValueError):
        return None


def cgroup_memory_headroom_bytes(
    *,
    cgroup_root: Path = Path("/sys/fs/cgroup"),
    proc_cgroup: Path = Path("/proc/self/cgroup"),
) -> int | None:
    """Return cgroup-v2 memory headroom, or ``None`` when it is unbounded.

    Containers commonly expose the host's RAM through ``psutil``.  A worker
    that trusts that number can claim a heavy render just before the kernel
    OOM-kills it.  The cgroup limit is the authoritative bound when one is
    present.  This helper remains best-effort for local macOS development and
    cgroup-v1 hosts, where no v2 limit is available.
    """
    values = _cgroup_v2_memory_values(cgroup_root=cgroup_root, proc_cgroup=proc_cgroup)
    return None if values is None else max(0, values[0] - values[1])


def cgroup_memory_limit_bytes() -> int | None:
    """Return the finite cgroup-v2 memory limit for capability registration."""
    values = _cgroup_v2_memory_values()
    return None if values is None else values[0]


def cgroup_cpu_limit_cores(
    *,
    cgroup_root: Path = Path("/sys/fs/cgroup"),
    proc_cgroup: Path = Path("/proc/self/cgroup"),
) -> float | None:
    """Return a finite cgroup-v2 CPU quota in cores when one is configured.

    ``os.cpu_count()`` describes CPUs visible to a container, not necessarily
    the amount it may consume. Docker's ``cpus: 7.5`` becomes
    ``cpu.max = 750000 100000``; benchmark evidence must bind that quota or a
    host-level run could be compared to production by mistake.
    """
    try:
        relative_path = None
        for line in proc_cgroup.read_text(encoding="utf-8").splitlines():
            hierarchy, controllers, path = line.split(":", 2)
            if hierarchy == "0" and controllers == "":
                relative_path = path.lstrip("/")
                break
        if relative_path is None:
            return None
        directory = (cgroup_root / relative_path).resolve()
        if cgroup_root.resolve() != directory and cgroup_root.resolve() not in directory.parents:
            return None
        quota, period = (directory / "cpu.max").read_text(encoding="utf-8").strip().split(maxsplit=1)
        if quota == "max":
            return None
        quota_value = int(quota)
        period_value = int(period)
        if quota_value <= 0 or period_value <= 0:
            return None
        return round(quota_value / period_value, 4)
    except (OSError, ValueError):
        return None


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
        if job_class in {"cpu_medium", "cpu_heavy"} and disk.free < self.settings.scratch_throttle_free_bytes:
            raise JobError(
                "SCRATCH_SPACE_THROTTLED",
                "Scratch disk is below the heavy-job admission threshold",
                retryable=True,
                details={"freeBytes": disk.free, "requiredBytes": self.settings.scratch_throttle_free_bytes},
            )
        system_available = psutil.virtual_memory().available
        cgroup_available = cgroup_memory_headroom_bytes()
        available_memory = min(
            system_available,
            cgroup_available if cgroup_available is not None else system_available,
        )
        if job_class in {"cpu_light", "cpu_medium", "cpu_heavy"} and available_memory < self.settings.minimum_available_memory_bytes:
            raise JobError(
                "MEMORY_PRESSURE",
                "Worker is under memory pressure",
                retryable=True,
                details={
                    "availableBytes": available_memory,
                    "systemAvailableBytes": system_available,
                    "cgroupAvailableBytes": cgroup_available,
                    "requiredBytes": self.settings.minimum_available_memory_bytes,
                },
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

    def available_scratch_bytes(self) -> int:
        self.settings.scratch_root.mkdir(parents=True, exist_ok=True)
        return shutil.disk_usage(self.settings.scratch_root).free


class StageResourceMetrics:
    """Low-overhead, best-effort resource telemetry for one worker job."""

    def __init__(self, job_dir: Path, sample_interval_seconds: float = 0.25):
        self.job_dir = job_dir
        self.sample_interval_seconds = sample_interval_seconds
        self.process = psutil.Process()
        self.started_at = time.monotonic()
        self.started_cpu = self.process.cpu_times()
        self.started_io = self._io_counters()
        self.peak_rss_bytes = self._rss_bytes()
        self.peak_scratch_bytes = self._directory_bytes()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sample, name="hve-resource-sampler", daemon=True)
        self._closed = False

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    def _rss_bytes(self) -> int:
        try:
            return self.process.memory_info().rss
        except (AttributeError, psutil.Error, OSError):
            return 0

    def _io_counters(self):
        try:
            return self.process.io_counters()
        except (AttributeError, psutil.Error, OSError):
            return None

    def _directory_bytes(self) -> int:
        try:
            return sum(path.stat().st_size for path in self.job_dir.rglob("*") if path.is_file())
        except (OSError, PermissionError):
            return 0

    def _sample(self) -> None:
        while not self._stop.wait(self.sample_interval_seconds):
            self.peak_rss_bytes = max(self.peak_rss_bytes, self._rss_bytes())
            self.peak_scratch_bytes = max(self.peak_scratch_bytes, self._directory_bytes())

    def close(self) -> dict[str, int | float]:
        if self._closed:
            return self.metrics()
        self._closed = True
        self._stop.set()
        self._thread.join(timeout=2)
        self.peak_rss_bytes = max(self.peak_rss_bytes, self._rss_bytes())
        self.peak_scratch_bytes = max(self.peak_scratch_bytes, self._directory_bytes())
        return self.metrics()

    def metrics(self) -> dict[str, int | float]:
        elapsed = max(0.0, time.monotonic() - self.started_at)
        try:
            current_cpu = self.process.cpu_times()
            cpu_seconds = max(0.0, (current_cpu.user + current_cpu.system) - (self.started_cpu.user + self.started_cpu.system))
        except (AttributeError, psutil.Error, OSError):
            cpu_seconds = 0.0
        current_io = self._io_counters()
        read_bytes = 0
        written_bytes = 0
        if current_io is not None and self.started_io is not None:
            read_bytes = max(0, current_io.read_bytes - self.started_io.read_bytes)
            written_bytes = max(0, current_io.write_bytes - self.started_io.write_bytes)
        return {
            "wallSeconds": round(elapsed, 3),
            "cpuSeconds": round(cpu_seconds, 3),
            "peakRssBytes": self.peak_rss_bytes,
            "peakScratchBytes": self.peak_scratch_bytes,
            "processReadBytes": read_bytes,
            "processWrittenBytes": written_bytes,
        }
