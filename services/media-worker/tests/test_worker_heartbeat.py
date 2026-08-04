import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.control_api import ControlApi, Job, LeaseLostError
from fourshort_worker import worker as worker_module
from fourshort_worker.runtime_identity import canonical_runtime_identity, runtime_fingerprint
from fourshort_worker.worker import LeaseHeartbeat, Worker


class FakeApi:
    def __init__(self):
        self.heartbeats = []

    def heartbeat(self, job_id, checkpoint=None, progress=None):
        self.heartbeats.append((job_id, checkpoint, progress))


class RegistrationApi:
    def __init__(self):
        self.registration = None

    def register(self, *, capabilities, metadata):
        self.registration = {"capabilities": capabilities, "metadata": metadata}


class WorkerHeartbeatTests(unittest.TestCase):
    def test_control_api_omits_unknown_progress_instead_of_serializing_null(self):
        requests = []

        class Response:
            status_code = 200

            def raise_for_status(self):
                return None

        class Client:
            def post(self, url, json):
                requests.append((url, json))
                return Response()

        api = object.__new__(ControlApi)
        api.settings = SimpleNamespace(worker_id="worker-test", lease_seconds=120)
        api.client = Client()

        api.heartbeat("job-1", checkpoint="started")

        self.assertEqual(requests[0][0], "/v1/internal/jobs/job-1/heartbeat")
        self.assertNotIn("progress", requests[0][1])

    def test_active_job_marker_is_atomic_and_cleanup_does_not_erase_newer_job(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            settings = SimpleNamespace(
                drain_file=base / "drain",
                active_job_file=base / "active-job.json",
            )
            worker = object.__new__(Worker)
            worker.settings = settings
            first = SimpleNamespace(id="job-1", job_class="cpu_heavy", type="render_clip")
            second = SimpleNamespace(id="job-2", job_class="cpu_medium", type="analyze_visual")
            worker.write_active_job(first)
            self.assertFalse(worker.is_draining())
            self.assertEqual(__import__("json").loads(settings.active_job_file.read_text())["jobId"], "job-1")
            worker.write_active_job(second)
            worker.clear_active_job("job-1")
            self.assertEqual(__import__("json").loads(settings.active_job_file.read_text())["jobId"], "job-2")
            settings.drain_file.touch()
            self.assertTrue(worker.is_draining())
            worker.clear_active_job("job-2")
            self.assertFalse(settings.active_job_file.exists())

    def test_worker_start_removes_only_stale_operational_marker(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            active_job_file = base / "active-job.json"
            active_job_file.write_text('{"jobId":"old"}', encoding="utf-8")
            settings = SimpleNamespace(
                drain_file=base / "drain",
                active_job_file=active_job_file,
            )
            with (
                patch.object(worker_module, "ControlApi", return_value=SimpleNamespace()),
                patch.object(worker_module, "Storage", return_value=SimpleNamespace()),
                patch.object(worker_module, "StageRunner", return_value=SimpleNamespace()),
                patch.object(worker_module, "ResourceGuard", return_value=SimpleNamespace()),
            ):
                Worker(settings)
            self.assertFalse(active_job_file.exists())

    def test_job_maps_wire_class_to_resource_class(self):
        job = Job.from_api({
            "id": "job-1",
            "workspaceId": "workspace-1",
            "projectId": None,
            "clipId": None,
            "type": "speech_to_text",
            "class": "cpu_heavy",
            "payload": {},
            "attemptCount": 1,
        })

        self.assertEqual(job.job_class, "cpu_heavy")

    def test_heartbeat_renews_long_running_job_and_health_file(self):
        api = FakeApi()
        job = SimpleNamespace(id="job-1", type="speech_to_text")
        with TemporaryDirectory() as directory:
            health_file = Path(directory) / "ready"
            with LeaseHeartbeat(api, job, 0.01, health_file):
                time.sleep(0.045)

            self.assertGreaterEqual(len(api.heartbeats), 2)
            self.assertEqual(api.heartbeats[0][1], "running:speech_to_text")
            self.assertTrue(health_file.exists())

    def test_lease_conflict_stops_the_active_worker_attempt(self):
        class LeaseLostApi:
            def heartbeat(self, *_args, **_kwargs):
                raise LeaseLostError("cancelled")

        job = SimpleNamespace(id="job-1", type="render_clip")
        with TemporaryDirectory() as directory:
            with LeaseHeartbeat(LeaseLostApi(), job, 0.01, Path(directory) / "ready") as heartbeat:
                time.sleep(0.035)
            self.assertTrue(heartbeat.cancellation_event.is_set())

    def test_runtime_identity_is_deterministic_and_changes_for_model_rollout(self):
        baseline = {
            "schemaVersion": 1,
            "engine": {"rendererVersion": "renderer-a", "plannerVersion": "planner-a"},
            "stt": {"modelStatus": "a" * 64, "computeType": "int8"},
        }
        same_values_different_order = {
            "stt": {"computeType": "int8", "modelStatus": "a" * 64},
            "engine": {"plannerVersion": "planner-a", "rendererVersion": "renderer-a"},
            "schemaVersion": 1,
        }
        changed_model = {
            **baseline,
            "stt": {"modelStatus": "b" * 64, "computeType": "int8"},
        }
        self.assertEqual(canonical_runtime_identity(baseline), canonical_runtime_identity(same_values_different_order))
        self.assertEqual(runtime_fingerprint(baseline), runtime_fingerprint(same_values_different_order))
        self.assertNotEqual(runtime_fingerprint(baseline), runtime_fingerprint(changed_model))

    def test_registration_advertises_a_complete_runtime_identity(self):
        """ETA calibration must receive the identity the worker actually runs."""
        with TemporaryDirectory() as directory:
            base = Path(directory)
            settings = SimpleNamespace(
                worker_version="0.2.0",
                worker_mode="12gb",
                hve_engine_version="hve-0.1",
                hve_planner_version="hve-planner-v2.0",
                hve_renderer_version="hve-renderer-v2-font-pack-1",
                ffmpeg_path="ffmpeg",
                ffmpeg_threads=4,
                memory_limit_bytes=10 * 1024**3,
                minimum_scratch_free_bytes=12 * 1024**3,
                scratch_throttle_free_bytes=20 * 1024**3,
                stt_model="large-v3-turbo",
                stt_device="cpu",
                stt_compute_type="int8",
                stt_vad_filter=True,
                face_sample_fps=3.0,
                vision_source_sample_fps=0.5,
                vision_source_max_samples=8000,
                vision_clip_sample_fps=3.0,
                vision_clip_max_samples=1500,
                health_file=base / "ready",
            )
            api = RegistrationApi()
            worker = object.__new__(Worker)
            worker.settings = settings
            worker.api = api
            worker.resources = SimpleNamespace(available_scratch_bytes=lambda: 80 * 1024**3)

            with (
                patch.object(worker_module.psutil, "virtual_memory", return_value=SimpleNamespace(total=12 * 1024**3)),
                patch.object(worker_module, "cgroup_memory_limit_bytes", return_value=10 * 1024**3),
                patch.object(worker_module, "cgroup_cpu_limit_cores", return_value=8.0),
                patch.object(worker_module, "stt_model_readiness", return_value=(True, "a" * 64)),
                patch.object(worker_module, "face_detector_readiness", return_value=(True, "b" * 64)),
                patch.object(worker_module, "installed_font_pack", return_value={
                    "available": True,
                    "id": "hve-sans-v1",
                    "packVersion": "hve-font-pack-dejavu-2.37-1",
                    "fileSha256": "c" * 64,
                }),
                patch.dict(worker_module.os.environ, {"FOURSHORT_WORKER_IMAGE_DIGEST": "sha256:" + "d" * 64}, clear=False),
            ):
                worker.register(draining=False)

            self.assertIsNotNone(api.registration)
            metadata = api.registration["metadata"]
            self.assertTrue(metadata["runtimeIdentityComplete"])
            self.assertEqual(len(metadata["runtimeFingerprint"]), 64)
            self.assertEqual(worker.active_runtime_fingerprint, metadata["runtimeFingerprint"])
            self.assertEqual(api.registration["capabilities"]["models"]["stt"], "a" * 64)

    def test_completed_job_metrics_carry_only_the_registered_runtime_identity(self):
        worker = object.__new__(Worker)
        worker.active_runtime_fingerprint = "e" * 64
        metrics = {"wallSeconds": 12.5}
        worker.annotate_runtime_metrics(metrics)
        self.assertEqual(metrics["runtimeFingerprint"], "e" * 64)

        worker.active_runtime_fingerprint = None
        unregistered_metrics = {"wallSeconds": 1}
        worker.annotate_runtime_metrics(unregistered_metrics)
        self.assertNotIn("runtimeFingerprint", unregistered_metrics)


if __name__ == "__main__":
    unittest.main()
