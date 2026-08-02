from __future__ import annotations

import logging
import os
import platform
import signal
import threading
import time
import traceback
import psutil

from .config import Settings
from .control_api import ControlApi
from .errors import JobError
from .resources import ResourceGuard
from .stages import StageRunner
from .storage import Storage

log = logging.getLogger("fourshort.worker")


def touch_health(path) -> None:
    path.write_text(str(time.time()), encoding="utf-8")


class LeaseHeartbeat:
    def __init__(self, api: ControlApi, job, interval_seconds: float, health_file):
        self.api = api
        self.job = job
        self.interval_seconds = interval_seconds
        self.health_file = health_file
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name=f"lease-heartbeat-{job.id}",
            daemon=True,
        )

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                self.api.heartbeat(self.job.id, checkpoint=f"running:{self.job.type}")
                touch_health(self.health_file)
            except Exception:
                log.exception("job heartbeat failed", extra={"job_id": self.job.id})

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_args) -> None:
        self._stop.set()
        self._thread.join(timeout=5)


class Worker:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.api = ControlApi(settings)
        self.resources = ResourceGuard(settings)
        self.stages = StageRunner(settings, Storage(settings))
        self.running = True

    @property
    def classes(self) -> list[str]:
        return ["io", "provider", "cpu_light", "cpu_heavy"]

    def stop(self, *_args) -> None:
        self.running = False

    def register(self) -> None:
        memory = psutil.virtual_memory()
        self.api.register(
            capabilities={
                "classes": self.classes,
                "jobTypes": [
                    "probe", "youtube_import", "extract_audio", "speech_to_text",
                    "find_moments", "face_track", "render_clip",
                ],
                "stt": {
                    "engine": "faster-whisper",
                    "model": self.settings.stt_model,
                    "device": self.settings.stt_device,
                    "computeType": self.settings.stt_compute_type,
                    "wordTimestamps": True,
                },
            },
            metadata={
                "mode": self.settings.worker_mode,
                "hostname": platform.node(),
                "platform": platform.platform(),
                "cpuCount": os.cpu_count() or 1,
                "memoryBytes": memory.total,
            },
        )
        touch_health(self.settings.health_file)

    def run_forever(self) -> None:
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)
        next_registration = 0.0
        while self.running:
            try:
                now = time.monotonic()
                if now >= next_registration:
                    self.register()
                    next_registration = now + self.settings.registration_seconds
                job = self.api.claim(self.classes)
                if not job:
                    time.sleep(self.settings.poll_seconds)
                    continue
                self.execute(job)
            except Exception:
                log.exception("worker polling failed")
                time.sleep(min(self.settings.poll_seconds * 2, 15))

    def execute(self, job) -> None:
        job_dir = None
        try:
            self.resources.assert_can_start(job.job_class)
            job_dir = self.resources.job_dir(job.id)
            self.api.heartbeat(job.id, checkpoint="started")
            touch_health(self.settings.health_file)
            with LeaseHeartbeat(
                self.api,
                job,
                self.settings.effective_heartbeat_seconds,
                self.settings.health_file,
            ):
                result, metrics = self.stages.run(job, job_dir)
            self.api.heartbeat(job.id, checkpoint="finalizing")
            self.api.complete(job.id, result, metrics)
        except JobError as error:
            self.api.fail(
                job.id,
                retryable=error.retryable,
                code=error.code,
                message=str(error),
                details=error.details,
            )
        except Exception as error:
            self.api.fail(
                job.id,
                retryable=True,
                code="UNHANDLED_WORKER_ERROR",
                message=str(error),
                details={"trace": traceback.format_exc(limit=8)},
            )
        finally:
            if job_dir is not None:
                self.resources.cleanup(job.id)
