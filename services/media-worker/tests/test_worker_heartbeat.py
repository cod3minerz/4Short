import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import time
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.control_api import Job
from fourshort_worker.worker import LeaseHeartbeat


class FakeApi:
    def __init__(self):
        self.heartbeats = []

    def heartbeat(self, job_id, checkpoint=None, progress=None):
        self.heartbeats.append((job_id, checkpoint, progress))


class WorkerHeartbeatTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
