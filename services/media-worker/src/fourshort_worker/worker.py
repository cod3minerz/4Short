from __future__ import annotations

import logging
import signal
import time
import traceback

from .config import Settings
from .control_api import ControlApi
from .errors import JobError
from .resources import ResourceGuard
from .stages import StageRunner
from .storage import Storage

log = logging.getLogger("fourshort.worker")


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

    def run_forever(self) -> None:
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)
        while self.running:
            try:
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
            job_class = job.payload.get("jobClass", "cpu_heavy" if job.type in {"render_clip", "face_track"} else "io")
            self.resources.assert_can_start(job_class)
            job_dir = self.resources.job_dir(job.id)
            self.api.heartbeat(job.id, checkpoint="started")
            result, metrics = self.stages.run(job, job_dir)
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
