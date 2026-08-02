import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.moments import (
    chunk_transcript,
    compact_transcript,
    deterministic_candidates,
    normalize_candidates,
)


class MomentPipelineTests(unittest.TestCase):
    def setUp(self):
        self.segments = compact_transcript({"segments": [
            {"start": 0, "end": 35, "text": "Первая законченная мысль"},
            {"start": 35, "end": 70, "text": "Вторая законченная мысль"},
            {"start": 70, "end": 105, "text": "Третья законченная мысль"},
        ]})

    def test_chunks_keep_small_overlap_without_losing_segments(self):
        chunks = chunk_transcript(self.segments, max_characters=120, overlap_segments=1)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0][-1], chunks[1][0])
        self.assertEqual(chunks[-1][-1].end_ms, 105_000)

    def test_normalization_rejects_bad_ranges_and_overlap_duplicates(self):
        result = normalize_candidates([
            {"startMs": 0, "endMs": 35_000, "title": "A", "score": 130},
            {"startMs": 1_000, "endMs": 34_000, "title": "duplicate"},
            {"startMs": 50_000, "endMs": 51_000, "title": "too short"},
            {"startMs": "bad", "endMs": 80_000},
        ], self.segments, {"durationMinSeconds": 20, "durationMaxSeconds": 60, "count": 10})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["score"], 100.0)

    def test_uniform_and_manual_modes_do_not_require_an_llm(self):
        uniform = deterministic_candidates(self.segments, {
            "mode": "uniform", "count": 3,
            "durationMinSeconds": 20, "durationMaxSeconds": 40,
        })
        manual = deterministic_candidates(self.segments, {
            "mode": "manual",
            "sourceRange": {"startSeconds": 35, "endSeconds": 70},
        })

        self.assertEqual(len(uniform or []), 3)
        self.assertEqual((manual or [])[0]["startMs"], 35_000)
        self.assertEqual((manual or [])[0]["endMs"], 70_000)


if __name__ == "__main__":
    unittest.main()
