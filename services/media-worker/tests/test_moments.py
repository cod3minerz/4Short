import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.moments import (
    chunk_transcript,
    compact_transcript,
    deterministic_candidates,
    normalize_candidates,
)
from fourshort_worker.errors import JobError
from fourshort_worker.stages import StageRunner


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

    def test_deterministic_modes_never_construct_an_llm_provider(self):
        runner = StageRunner(SimpleNamespace(), object())
        settings = {
            "durationMinSeconds": 20,
            "durationMaxSeconds": 40,
        }
        jobs = [
            SimpleNamespace(payload={
                "transcript": {"segments": [
                    {"start": item.start_ms / 1000, "end": item.end_ms / 1000, "text": item.text}
                    for item in self.segments
                ]},
                "settings": {**settings, "mode": "uniform", "count": 3},
            }),
            SimpleNamespace(payload={
                "transcript": {"segments": [
                    {"start": item.start_ms / 1000, "end": item.end_ms / 1000, "text": item.text}
                    for item in self.segments
                ]},
                "settings": {
                    **settings,
                    "mode": "manual",
                    "sourceRange": {"startSeconds": 35, "endSeconds": 70},
                },
            }),
        ]

        with patch("fourshort_worker.stages.create_llm_provider", side_effect=AssertionError("LLM must stay unused")):
            results = [runner.find_moments(job) for job in jobs]

        self.assertEqual([result["provider"] for result in results], ["deterministic", "deterministic"])
        self.assertEqual(len(results[0]["candidates"]), 3)
        self.assertEqual((results[1]["candidates"][0]["startMs"], results[1]["candidates"][0]["endMs"]), (35_000, 70_000))

    def test_uniform_candidates_obey_max_duration_and_cover_the_source_evenly(self):
        candidates = deterministic_candidates(self.segments, {
            "mode": "uniform", "count": 2,
            "durationMinSeconds": 10, "durationMaxSeconds": 15,
        })

        self.assertEqual(len(candidates or []), 2)
        self.assertEqual([(item["startMs"], item["endMs"]) for item in candidates or []], [
            (0, 15_000), (90_000, 105_000),
        ])
        self.assertTrue(all(10_000 <= item["endMs"] - item["startMs"] <= 15_000 for item in candidates or []))

    def test_single_uniform_candidate_is_centered_and_never_expands_to_source_end(self):
        candidates = deterministic_candidates(self.segments, {
            "mode": "uniform", "count": 1,
            "durationMinSeconds": 10, "durationMaxSeconds": 15,
        })

        self.assertEqual(len(candidates or []), 1)
        self.assertEqual(candidates[0]["startMs"], 45_000)
        self.assertEqual(candidates[0]["endMs"], 60_000)

    def test_uniform_count_is_reduced_with_a_warning_when_minimums_would_not_fit(self):
        candidates = deterministic_candidates(self.segments, {
            "mode": "uniform", "count": 12,
            "durationMinSeconds": 20, "durationMaxSeconds": 30,
        })

        self.assertEqual(len(candidates or []), 5)
        self.assertTrue(all("REQUESTED_COUNT_REDUCED_TO_FIT_DURATION" in item["warnings"] for item in candidates or []))

    def test_uniform_rejects_a_source_range_shorter_than_minimum(self):
        with self.assertRaises(JobError) as context:
            deterministic_candidates(self.segments, {
                "mode": "uniform", "count": 1,
                "durationMinSeconds": 20, "durationMaxSeconds": 30,
                "sourceRange": {"startSeconds": 0, "endSeconds": 10},
            })
        self.assertEqual(context.exception.code, "SOURCE_RANGE_TOO_SHORT")

    def test_manual_rejects_a_source_range_outside_the_requested_duration(self):
        for selected_range in ({"startSeconds": 0, "endSeconds": 9}, {"startSeconds": 0, "endSeconds": 31}):
            with self.subTest(selected_range=selected_range):
                with self.assertRaises(JobError) as context:
                    deterministic_candidates(self.segments, {
                        "mode": "manual",
                        "durationMinSeconds": 10,
                        "durationMaxSeconds": 30,
                        "sourceRange": selected_range,
                    })
                self.assertEqual(context.exception.code, "MANUAL_RANGE_DURATION_INVALID")

    def test_manual_uses_the_exact_requested_range_when_it_matches_duration(self):
        candidates = deterministic_candidates(self.segments, {
            "mode": "manual",
            "durationMinSeconds": 30,
            "durationMaxSeconds": 60,
            "sourceRange": {"startSeconds": 35, "endSeconds": 70},
        })

        self.assertEqual([(item["startMs"], item["endMs"]) for item in candidates or []], [(35_000, 70_000)])


if __name__ == "__main__":
    unittest.main()
