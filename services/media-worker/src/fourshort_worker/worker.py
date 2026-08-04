from __future__ import annotations

import logging
import os
import platform
import json
import re
import signal
import threading
import time
import traceback
import psutil

from .config import Settings
from .control_api import ControlApi, LeaseLostError
from .errors import JobError
from .fonts import installed_font_pack
from .model_assets import face_detector_readiness, stt_model_readiness
from .resources import ResourceGuard, StageResourceMetrics, cgroup_cpu_limit_cores, cgroup_memory_limit_bytes
from .runtime_identity import RUNTIME_IDENTITY_SCHEMA_VERSION, runtime_fingerprint
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
        self.cancellation_event = threading.Event()

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                self.api.heartbeat(self.job.id, checkpoint=f"running:{self.job.type}")
                touch_health(self.health_file)
            except LeaseLostError:
                # Cancellation and lease expiration are terminal for this
                # attempt.  Heavy subprocesses observe this event and stop;
                # the worker must never try to complete a job it no longer
                # owns.
                self.cancellation_event.set()
                return
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
        # A marker is process-local operational telemetry. If this worker
        # process has restarted, no previous attempt can still be executing in
        # its container, so retaining the old marker would make drain/status
        # tooling report a phantom active job.
        self.settings.active_job_file.unlink(missing_ok=True)
        self.api = ControlApi(settings)
        self.resources = ResourceGuard(settings)
        self.stages = StageRunner(settings, Storage(settings))
        self.running = True
        # Set only after a successful registration. A completed attempt carries
        # this immutable identity so ETA never mixes timings from a different
        # HVE/model/font/runtime configuration.
        self.active_runtime_fingerprint: str | None = None

    @property
    def classes(self) -> list[str]:
        return ["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"]

    def stop(self, *_args) -> None:
        self.running = False

    def is_draining(self) -> bool:
        return self.settings.drain_file.exists()

    def write_active_job(self, job) -> None:
        """Publish only operational state; never customer source metadata."""
        target = self.settings.active_job_file
        target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps({
            "jobId": job.id,
            "jobClass": job.job_class,
            "jobType": job.type,
            "startedAt": int(time.time()),
        }, separators=(",", ":")), encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(target)

    def clear_active_job(self, job_id: str) -> None:
        target = self.settings.active_job_file
        try:
            # Do not erase a newer job marker if shutdown/cleanup from a
            # previous attempt races the next serial claim.
            current = json.loads(target.read_text(encoding="utf-8"))
            if current.get("jobId") == job_id:
                target.unlink(missing_ok=True)
        except FileNotFoundError:
            return
        except (OSError, ValueError, TypeError, AttributeError):
            # A malformed marker must never prevent cleanup or change job
            # ownership. Remove only the worker-local status artifact.
            target.unlink(missing_ok=True)

    def register(self, *, draining: bool | None = None) -> None:
        draining = self.is_draining() if draining is None else draining
        memory = psutil.virtual_memory()
        cgroup_memory_limit = cgroup_memory_limit_bytes()
        advertised_memory = cgroup_memory_limit or memory.total
        stt_ready, stt_model_status = stt_model_readiness(self.settings)
        face_ready, face_model_status = face_detector_readiness(self.settings)
        font_pack = installed_font_pack()
        cgroup_cpu_limit = cgroup_cpu_limit_cores()
        image_digest = os.environ.get("FOURSHORT_WORKER_IMAGE_DIGEST") or "unresolved"
        image_digest_complete = bool(re.fullmatch(r"sha256:[a-f0-9]{64}", image_digest, flags=re.IGNORECASE))
        job_types = [
            "probe", "youtube_import", "extract_audio", "generate_proxy", "verify_brand_video",
            "find_moments", "analyze_visual", "analyze_clip_visual", "face_track", "render_clip",
            "zip_project",
        ]
        # Advertise STT only after the immutable local model pack has passed
        # verification. Capability admission then leaves transcript jobs in
        # the queue rather than leasing them to a worker that cannot serve
        # them.
        if stt_ready:
            job_types.insert(3, "speech_to_text")
        capabilities = {
                "engineVersion": self.settings.hve_engine_version,
                "plannerVersion": self.settings.hve_planner_version,
                "rendererVersion": self.settings.hve_renderer_version,
                "jobClasses": self.classes,
                "models": {
                    "stt": stt_model_status if stt_ready else f"unavailable:{stt_model_status}",
                    "face_detector": face_model_status if face_ready else f"unavailable:{face_model_status}",
                },
                # Under containers psutil may report host RAM.  The queue must
                # schedule from the enforced cgroup limit instead.
                "memoryBytes": advertised_memory,
                "scratchFreeBytes": self.resources.available_scratch_bytes(),
                # This worker loop is serial.  A medium source-analysis job
                # can run, but never in parallel with a heavy STT/encode.
                "heavySlots": 1,
                "mediumSlots": 1,
                "maxConcurrentJobs": 1,
                "jobTypes": job_types,
                "stt": {
                    "engine": "faster-whisper",
                    "model": self.settings.stt_model,
                    "modelReady": stt_ready,
                    "device": self.settings.stt_device,
                    "computeType": self.settings.stt_compute_type,
                    "wordTimestamps": True,
                    "sileroVad": self.settings.stt_vad_filter,
                },
                "vision": {
                    "engine": "opencv-yunet-sparse-source-v1",
                    "enabled": face_ready,
                    "modelAvailable": face_ready,
                    "sampleFps": self.settings.face_sample_fps,
                    "sourceSampleFps": self.settings.vision_source_sample_fps,
                    "sourceMaxSamples": self.settings.vision_source_max_samples,
                    "clipSampleFps": self.settings.vision_clip_sample_fps,
                    "clipMaxSamples": self.settings.vision_clip_max_samples,
                    "activeSpeakerAssociation": False,
                },
                "subtitles": {
                    "engine": "libass",
                    "modes": ["line", "active_word", "karaoke", "word_by_word"],
                    "fontPack": font_pack,
                },
        }
        # The descriptor is intentionally small and contains no endpoint,
        # hostname, source or credential. It is enough to reject an ETA based
        # on older model/image/cgroup observations after a rollout.
        runtime_descriptor = {
            "schemaVersion": RUNTIME_IDENTITY_SCHEMA_VERSION,
            "workerVersion": self.settings.worker_version,
            "workerMode": self.settings.worker_mode,
            "imageDigest": image_digest,
            "engine": {
                "engineVersion": self.settings.hve_engine_version,
                "plannerVersion": self.settings.hve_planner_version,
                "rendererVersion": self.settings.hve_renderer_version,
                "ffmpegPath": self.settings.ffmpeg_path,
                "ffmpegThreads": self.settings.ffmpeg_threads,
            },
            "resources": {
                "cgroupCpuLimitCores": cgroup_cpu_limit,
                "cgroupMemoryLimitBytes": cgroup_memory_limit,
                "memoryLimitBytes": self.settings.memory_limit_bytes,
            },
            "stt": {
                "engine": "faster-whisper",
                "model": self.settings.stt_model,
                "modelStatus": stt_model_status if stt_ready else f"unavailable:{stt_model_status}",
                "device": self.settings.stt_device,
                "computeType": self.settings.stt_compute_type,
                "vadFilter": self.settings.stt_vad_filter,
            },
            "vision": {
                "engine": "opencv-yunet-sparse-source-v1",
                "faceModelStatus": face_model_status if face_ready else f"unavailable:{face_model_status}",
                "faceSampleFps": self.settings.face_sample_fps,
                "sourceSampleFps": self.settings.vision_source_sample_fps,
                "clipSampleFps": self.settings.vision_clip_sample_fps,
            },
            "fontPack": font_pack,
        }
        current_runtime_fingerprint = runtime_fingerprint(runtime_descriptor)
        metadata = {
                "mode": self.settings.worker_mode,
                "hostname": platform.node(),
                "platform": platform.platform(),
                "cpuCount": os.cpu_count() or 1,
                "cgroupCpuLimitCores": cgroup_cpu_limit,
                "memoryBytes": advertised_memory,
                "hostMemoryBytes": memory.total,
                "cgroupMemoryLimitBytes": cgroup_memory_limit,
                "runtimeFingerprint": current_runtime_fingerprint,
                "runtimeIdentitySchemaVersion": RUNTIME_IDENTITY_SCHEMA_VERSION,
                # An unpinned local/development invocation may execute, but
                # its timing must never calibrate production ETA.
                "runtimeIdentityComplete": image_digest_complete,
                "resourcePolicy": {
                    "hardScratchFloorBytes": self.settings.minimum_scratch_free_bytes,
                    "heavyScratchThrottleBytes": self.settings.scratch_throttle_free_bytes,
                    # Current provider calls are synchronous; the value is a
                    # truthful capability signal until the async executor lands.
                    "providerWaitingFreesMediaSlot": False,
                },
                "draining": draining,
        }
        self.api.register(capabilities=capabilities, metadata=metadata)
        self.active_runtime_fingerprint = current_runtime_fingerprint
        touch_health(self.settings.health_file)

    def annotate_runtime_metrics(self, metrics: dict) -> None:
        """Attach the registered runtime to a completed-job observation.

        This is deliberately a small boundary: a missing registration must
        not invent a runtime fingerprint, while every registered worker must
        leave an ETA-safe observation for the control API.
        """
        if self.active_runtime_fingerprint:
            metrics["runtimeFingerprint"] = self.active_runtime_fingerprint

    def run_forever(self) -> None:
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)
        next_registration = 0.0
        last_drain_state: bool | None = None
        while self.running:
            try:
                now = time.monotonic()
                draining = self.is_draining()
                if now >= next_registration or draining != last_drain_state:
                    self.register(draining=draining)
                    next_registration = now + self.settings.registration_seconds
                    last_drain_state = draining
                if draining:
                    # Keep heartbeating/advertising capability while the drain
                    # is active, but never claim another customer job.
                    time.sleep(self.settings.poll_seconds)
                    continue
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
        resources = None
        try:
            self.resources.assert_can_start(job.job_class)
            job_dir = self.resources.job_dir(job.id)
            try:
                self.api.heartbeat(job.id, checkpoint="started")
            except LeaseLostError:
                log.info("job was cancelled before stage start", extra={"job_id": job.id})
                return
            touch_health(self.settings.health_file)
            self.write_active_job(job)
            with StageResourceMetrics(job_dir) as resources, LeaseHeartbeat(
                    self.api,
                    job,
                    self.settings.effective_heartbeat_seconds,
                    self.settings.health_file,
            ) as heartbeat:
                result, metrics = self.stages.run(
                    job,
                    job_dir,
                    cancellation_event=heartbeat.cancellation_event,
                )
                if heartbeat.cancellation_event.is_set():
                    return
            metrics.update(resources.metrics())
            self.annotate_runtime_metrics(metrics)
            self.api.heartbeat(job.id, checkpoint="finalizing")
            self.api.complete(job.id, result, metrics)
        except JobError as error:
            if error.code == "JOB_CANCELLED":
                log.info("job stopped after cancellation or lease loss", extra={"job_id": job.id})
                return
            details = dict(error.details)
            if resources is not None:
                details["resourceMetrics"] = resources.close()
            self.api.fail(
                job.id,
                retryable=error.retryable,
                code=error.code,
                message=str(error),
                details=details,
            )
        except Exception as error:
            details = {"trace": traceback.format_exc(limit=8)}
            if resources is not None:
                details["resourceMetrics"] = resources.close()
            self.api.fail(
                job.id,
                retryable=True,
                code="UNHANDLED_WORKER_ERROR",
                message=str(error),
                details=details,
            )
        finally:
            self.clear_active_job(job.id)
            if job_dir is not None:
                self.resources.cleanup(job.id)
