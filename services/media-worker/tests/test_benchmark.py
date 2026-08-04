import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.benchmark import realtime_factor


class BenchmarkTests(unittest.TestCase):
    def test_realtime_factor_is_duration_normalized_and_refuses_invalid_duration(self):
        self.assertEqual(realtime_factor(32.25, 60), 0.5375)
        self.assertIsNone(realtime_factor(1, 0))
        self.assertIsNone(realtime_factor(-1, 60))


if __name__ == "__main__":
    unittest.main()
