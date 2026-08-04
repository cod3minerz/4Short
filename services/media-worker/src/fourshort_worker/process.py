from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import threading
import time
from typing import Iterable

import psutil

from .errors import JobError


class _SubprocessMetrics:
    """Samples a child process tree without retaining its output or frames."""

    def __init__(self, pid: int, interval_seconds: float = 0.1):
        self.process = psutil.Process(pid)
        self.interval_seconds = interval_seconds
        self.started_at = time.monotonic()
        self.peak_rss_bytes = 0
        self.peak_cpu_seconds = 0.0
        self.peak_read_bytes = 0
        self.peak_written_bytes = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sample, name=f"hve-process-metrics-{pid}", daemon=True)

    def _sample_once(self) -> None:
        try:
            processes = [self.process, *self.process.children(recursive=True)]
        except (psutil.Error, OSError):
            return
        rss = 0
        cpu = 0.0
        read_bytes = 0
        written_bytes = 0
        for process in processes:
            try:
                rss += process.memory_info().rss
                times = process.cpu_times()
                cpu += times.user + times.system
                io = process.io_counters()
                read_bytes += io.read_bytes
                written_bytes += io.write_bytes
            except (psutil.Error, OSError, AttributeError):
                continue
        self.peak_rss_bytes = max(self.peak_rss_bytes, rss)
        self.peak_cpu_seconds = max(self.peak_cpu_seconds, cpu)
        self.peak_read_bytes = max(self.peak_read_bytes, read_bytes)
        self.peak_written_bytes = max(self.peak_written_bytes, written_bytes)

    def _sample(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            self._sample_once()

    def start(self) -> None:
        self._sample_once()
        self._thread.start()

    def close(self) -> dict[str, int | float]:
        self._stop.set()
        self._thread.join(timeout=1)
        self._sample_once()
        return {
            "subprocessWallSeconds": round(max(0.0, time.monotonic() - self.started_at), 3),
            "subprocessPeakRssBytes": self.peak_rss_bytes,
            "subprocessCpuSeconds": round(self.peak_cpu_seconds, 3),
            "subprocessReadBytes": self.peak_read_bytes,
            "subprocessWrittenBytes": self.peak_written_bytes,
        }


def run_command(
    args: Iterable[str],
    *,
    timeout_seconds: int,
    cwd: Path | None = None,
    capture_json: bool = False,
    capture_stderr: bool = False,
    process_metrics: dict[str, int | float] | None = None,
    cancellation_event: threading.Event | None = None,
) -> str | dict:
    command = [str(value) for value in args]
    if not command or any("\x00" in value for value in command):
        raise JobError("INVALID_COMMAND", "Invalid subprocess arguments", retryable=False)
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env={**os.environ, "LC_ALL": "C.UTF-8"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False,
            start_new_session=True,
        )
    except OSError as error:
        raise JobError("PROCESS_START_FAILED", f"Could not start {Path(command[0]).name}", retryable=False) from error

    metrics = _SubprocessMetrics(process.pid)
    metrics.start()
    deadline = time.monotonic() + timeout_seconds
    try:
        while True:
            if cancellation_event is not None and cancellation_event.is_set():
                # A filtergraph/encoder may have descendants. Killing the
                # process group is required; killing only the parent leaves a
                # child decoding against scratch after a user cancelled.
                try:
                    os.killpg(process.pid, 15)
                except ProcessLookupError:
                    pass
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, 9)
                    except ProcessLookupError:
                        pass
                    process.communicate()
                raise JobError(
                    "JOB_CANCELLED",
                    "Job was cancelled while the media process was running",
                    retryable=False,
                    details={"binary": command[0]},
                )
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout_seconds)
            try:
                stdout, stderr = process.communicate(timeout=min(0.5, remaining))
                break
            except subprocess.TimeoutExpired:
                continue
    except subprocess.TimeoutExpired as error:
        try:
            os.killpg(process.pid, 15)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, 9)
            except ProcessLookupError:
                pass
            process.communicate()
        raise JobError(
            "PROCESS_TIMEOUT",
            f"Process exceeded {timeout_seconds} seconds",
            retryable=True,
            details={"binary": command[0]},
        ) from error
    finally:
        if process_metrics is not None:
            process_metrics.update(metrics.close())

    if process.returncode != 0:
        raise JobError(
            "PROCESS_FAILED",
            f"{Path(command[0]).name} failed",
            retryable=process.returncode in {137, 143, 255},
            details={"returnCode": process.returncode, "stderr": stderr[-2000:]},
        )
    if capture_json:
        if capture_stderr:
            raise JobError("INVALID_COMMAND", "A command cannot capture JSON and stderr together", retryable=False)
        try:
            return json.loads(stdout)
        except json.JSONDecodeError as error:
            raise JobError("INVALID_PROCESS_OUTPUT", "Process returned invalid JSON", retryable=False) from error
    return stderr if capture_stderr else stdout
