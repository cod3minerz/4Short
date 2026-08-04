import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
import unittest

import psutil

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.errors import JobError
from fourshort_worker.process import run_command


class ProcessCancellationTests(unittest.TestCase):
    def test_cancellation_stops_a_running_process_group(self):
        cancelled = threading.Event()
        timer = threading.Timer(0.1, cancelled.set)
        started = time.monotonic()
        timer.start()
        try:
            with self.assertRaises(JobError) as context:
                run_command(
                    [sys.executable, "-c", "import time; time.sleep(30)"],
                    timeout_seconds=60,
                    cancellation_event=cancelled,
                )
        finally:
            timer.cancel()
        self.assertEqual(context.exception.code, "JOB_CANCELLED")
        self.assertLess(time.monotonic() - started, 3)

    def test_cancellation_terminates_a_descendant_not_only_the_parent(self):
        """The FFmpeg process group must not leave an encoder descendant alive.

        A lone parent-process test misses the failure mode that matters for a
        heavy render: the parent may exit, while a decoder or encoder child
        continues consuming CPU and scratch after its lease is lost. The child
        writes its PID before both processes block, so the assertion observes
        the actual process rather than inferring cleanup from a return code.
        """
        with TemporaryDirectory() as directory:
            child_pid_file = Path(directory) / "child.pid"
            cancelled = threading.Event()
            child_program = (
                "import pathlib, subprocess, sys, time; "
                "child=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']); "
                f"pathlib.Path({str(child_pid_file)!r}).write_text(str(child.pid)); "
                "time.sleep(30)"
            )
            # Cancellation must happen *after* the child exists. A fixed
            # sub-second timer races Python process startup under CI load and
            # can make a process-tree test fail before there is a tree to
            # inspect. This does not weaken the assertion: the runner still
            # receives cancellation immediately once the descendant is live.
            def cancel_after_child_starts():
                deadline = time.monotonic() + 5
                while not child_pid_file.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                cancelled.set()

            canceller = threading.Thread(target=cancel_after_child_starts, daemon=True)
            canceller.start()
            try:
                with self.assertRaises(JobError) as context:
                    run_command(
                        [sys.executable, "-c", child_program],
                        timeout_seconds=60,
                        cancellation_event=cancelled,
                    )
            finally:
                canceller.join(timeout=1)

            self.assertEqual(context.exception.code, "JOB_CANCELLED")
            self.assertTrue(child_pid_file.exists(), "nested process did not start before cancellation")
            child_pid = int(child_pid_file.read_text(encoding="utf-8"))
            # SIGTERM is delivered to the isolated process group. Give init a
            # short chance to reap the child before making a strict assertion.
            deadline = time.monotonic() + 1
            while psutil.pid_exists(child_pid) and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertFalse(psutil.pid_exists(child_pid), "lease cancellation left a descendant process alive")


if __name__ == "__main__":
    unittest.main()
