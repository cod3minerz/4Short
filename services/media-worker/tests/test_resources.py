import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.errors import JobError
from fourshort_worker.media import ffmpeg_thread_args
from fourshort_worker.resources import (
    ResourceGuard,
    StageResourceMetrics,
    cgroup_cpu_limit_cores,
    cgroup_memory_headroom_bytes,
)
from fourshort_worker.stages import StageRunner


class ResourceTests(unittest.TestCase):
    def settings(self, root, **overrides):
        values = {
            "scratch_root": Path(root),
            "minimum_scratch_free_bytes": 1,
            "scratch_throttle_free_bytes": 1,
            "minimum_available_memory_bytes": 1,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_metrics_include_wall_cpu_and_scratch_usage(self):
        with TemporaryDirectory() as directory:
            job_dir = Path(directory) / "job-1"
            job_dir.mkdir()
            with StageResourceMetrics(job_dir, sample_interval_seconds=0.01) as metrics:
                (job_dir / "fragment.bin").write_bytes(b"x" * 4096)
            result = metrics.metrics()
            self.assertIn("wallSeconds", result)
            self.assertIn("cpuSeconds", result)
            self.assertGreaterEqual(result["peakScratchBytes"], 4096)
            self.assertGreater(result["peakRssBytes"], 0)

    def test_heavy_job_is_throttled_before_hard_disk_floor(self):
        with TemporaryDirectory() as directory:
            guard = ResourceGuard(self.settings(directory, scratch_throttle_free_bytes=10 ** 30))
            with self.assertRaises(JobError) as context:
                guard.assert_can_start("cpu_heavy")
            self.assertEqual(context.exception.code, "SCRATCH_SPACE_THROTTLED")

    def test_cgroup_v2_headroom_uses_the_container_limit(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / "cgroup"
            group = root / "tenant" / "worker"
            group.mkdir(parents=True)
            (group / "memory.max").write_text("2147483648\n", encoding="utf-8")
            (group / "memory.current").write_text("1610612736\n", encoding="utf-8")
            proc = Path(directory) / "proc-cgroup"
            proc.write_text("0::/tenant/worker\n", encoding="utf-8")
            self.assertEqual(
                cgroup_memory_headroom_bytes(cgroup_root=root, proc_cgroup=proc),
                512 * 1024**2,
            )

    def test_cgroup_v2_cpu_quota_uses_the_container_limit(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / "cgroup"
            group = root / "tenant" / "worker"
            group.mkdir(parents=True)
            (group / "cpu.max").write_text("750000 100000\n", encoding="utf-8")
            proc = Path(directory) / "proc-cgroup"
            proc.write_text("0::/tenant/worker\n", encoding="utf-8")
            self.assertEqual(cgroup_cpu_limit_cores(cgroup_root=root, proc_cgroup=proc), 7.5)

    def test_cgroup_v2_cpu_quota_refuses_an_unbounded_host(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / "cgroup"
            group = root / "tenant" / "worker"
            group.mkdir(parents=True)
            (group / "cpu.max").write_text("max 100000\n", encoding="utf-8")
            proc = Path(directory) / "proc-cgroup"
            proc.write_text("0::/tenant/worker\n", encoding="utf-8")
            self.assertIsNone(cgroup_cpu_limit_cores(cgroup_root=root, proc_cgroup=proc))

    def test_memory_admission_prefers_cgroup_headroom_over_host_memory(self):
        with TemporaryDirectory() as directory:
            guard = ResourceGuard(self.settings(directory, minimum_available_memory_bytes=1024))
            with patch("fourshort_worker.resources.cgroup_memory_headroom_bytes", return_value=512), patch(
                "fourshort_worker.resources.psutil.virtual_memory",
                return_value=SimpleNamespace(available=1024 * 1024),
            ), self.assertRaises(JobError) as context:
                guard.assert_can_start("cpu_heavy")
            self.assertEqual(context.exception.code, "MEMORY_PRESSURE")
            self.assertEqual(context.exception.details["cgroupAvailableBytes"], 512)

    def test_ffmpeg_thread_policy_is_explicit_and_bounded(self):
        self.assertEqual(
            ffmpeg_thread_args(SimpleNamespace(ffmpeg_threads=99), filtergraph=True),
            ["-threads", "8", "-filter_threads", "8", "-filter_complex_threads", "8"],
        )
        self.assertEqual(ffmpeg_thread_args(SimpleNamespace(ffmpeg_threads=0)), ["-threads", "1"])

    def test_stage_runner_moves_child_process_metrics_to_job_attempt_metrics(self):
        runner = object.__new__(StageRunner)
        runner.probe = lambda _job, **_kwargs: {
            "artifact": {"key": "ignored"},
            "executionMetrics": {"subprocessPeakRssBytes": 12_345, "subprocessWallSeconds": 0.25},
        }
        result, metrics = runner.run(SimpleNamespace(type="probe"), Path("/tmp"))
        self.assertNotIn("executionMetrics", result)
        self.assertEqual(metrics["subprocessPeakRssBytes"], 12_345)
        self.assertEqual(metrics["subprocessWallSeconds"], 0.25)

    def test_stage_runner_forwards_lease_cancellation_to_visual_stages(self):
        runner = object.__new__(StageRunner)
        cancelled = threading.Event()
        seen: list[tuple[str, object]] = []
        runner.face_track = lambda _job, *, cancellation_event=None: (
            seen.append(("face", cancellation_event)) or {"stage": "face"}
        )
        runner.analyze_visual = lambda _job, _job_dir, *, cancellation_event=None: (
            seen.append(("visual", cancellation_event)) or {"stage": "visual"}
        )
        runner.speech_to_text = lambda _job, _job_dir, *, cancellation_event=None: (
            seen.append(("stt", cancellation_event)) or {"stage": "stt"}
        )
        runner.find_moments = lambda _job, *, cancellation_event=None: (
            seen.append(("moments", cancellation_event)) or {"stage": "moments"}
        )
        runner.run(SimpleNamespace(type="face_track"), Path("/tmp"), cancellation_event=cancelled)
        runner.run(SimpleNamespace(type="analyze_visual"), Path("/tmp"), cancellation_event=cancelled)
        runner.run(SimpleNamespace(type="speech_to_text"), Path("/tmp"), cancellation_event=cancelled)
        runner.run(SimpleNamespace(type="find_moments"), Path("/tmp"), cancellation_event=cancelled)
        self.assertEqual(seen, [
            ("face", cancelled),
            ("visual", cancelled),
            ("stt", cancelled),
            ("moments", cancelled),
        ])

    def test_visual_analysis_does_not_publish_graph_after_lease_cancellation(self):
        """A stale visual pass can be expensive, but it must stay private.

        The cancellation can arrive after OpenCV has analysed its last sample
        and before the graph would be persisted. Publishing in that window
        could cause a later worker lease to consume obsolete facts.
        """
        with TemporaryDirectory() as directory:
            runner = object.__new__(StageRunner)
            uploaded: list[object] = []
            runner.settings = SimpleNamespace(
                vision_clip_sample_fps=2.0,
                vision_source_sample_fps=0.5,
                vision_clip_max_samples=60,
                vision_source_max_samples=600,
                effective_derived_bucket="derived",
                object_key=lambda *_args: "derived/scene-graph-v1.json",
                hve_engine_version="hve-test",
                hve_planner_version="planner-test",
                hve_renderer_version="renderer-test",
            )
            runner.storage = SimpleNamespace(upload_file=lambda *_args: uploaded.append(_args))
            runner.source_url = lambda _payload: "https://example.invalid/source.mp4"
            cancelled = threading.Event()
            graph = {
                "durationUs": 1_000_000,
                "warnings": [],
                "shots": [],
                "regions": [],
                "classifications": [],
                "speakerTurns": [],
                "activeSpeakerLinks": [],
                "_summary": {
                    "density": "sparse",
                    "coverage": [{"startUs": 0, "endUs": 1_000_000}],
                },
            }

            with patch("fourshort_worker.stages.SparseSourcePerception") as perception:
                perception.return_value.analyze.side_effect = lambda *_args, **_kwargs: (cancelled.set() or graph.copy())
                job = SimpleNamespace(
                    type="analyze_visual",
                    workspace_id="workspace-1",
                    payload={
                        "source": {"kind": "s3"},
                        "sourceId": "source-1",
                        "sourceHash": "a" * 64,
                        "analysisId": "analysis-1",
                    },
                )
                with self.assertRaises(JobError) as context:
                    runner.analyze_visual(job, Path(directory), cancellation_event=cancelled)

            self.assertEqual(context.exception.code, "JOB_CANCELLED")
            self.assertEqual(uploaded, [])
            self.assertFalse((Path(directory) / "scene-graph-v1.json").exists())


if __name__ == "__main__":
    unittest.main()
