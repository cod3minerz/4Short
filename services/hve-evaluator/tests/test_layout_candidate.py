import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[2] / "media-worker" / "src"))
sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from hve_evaluator.layout_candidate import Box, _Track, _merge_segments, _track_boxes, choose_layout_template


def track(region_id: str, kind: str, observations: int = 2) -> _Track:
    return _Track(
        region_id=region_id,
        kind=kind,
        box=Box(0.1, 0.1, 0.25, 0.25),
        first_ms=0,
        last_ms=1_000,
        observations=observations,
        confidence_sum=0.7 * observations,
    )


class LayoutCandidateTests(unittest.TestCase):
    def test_baseline_never_upgrades_a_talking_head_without_independent_structure(self):
        self.assertEqual(choose_layout_template([track("face-001", "face_candidate")], []), "portrait_focus")
        self.assertEqual(
            choose_layout_template([track("face-001", "face_candidate")], [track("structure-001", "structure_candidate")]),
            "screen_speaker",
        )

    def test_baseline_uses_only_durable_face_topology_for_panel_candidates(self):
        self.assertEqual(
            choose_layout_template([track("face-1", "face_candidate"), track("face-2", "face_candidate"), track("face-3", "face_candidate")], []),
            "grid_3",
        )
        self.assertEqual(
            choose_layout_template([track(f"face-{index}", "face_candidate") for index in range(4)], []),
            "grid_4",
        )
        self.assertEqual(
            choose_layout_template([track("face-1", "face_candidate", observations=1), track("face-2", "face_candidate", observations=1), track("face-3", "face_candidate", observations=1)], []),
            "portrait_focus",
        )

    def test_expired_tracks_are_archived_for_evaluator_mapping_and_not_reused_live(self):
        active = [track("face-001", "face_candidate")]
        archived: list[_Track] = []
        for at_ms in [1_000, 2_000, 3_000]:
            _, _ = _track_boxes(
                active, archived, [], kind="face_candidate", prefix="face", at_ms=at_ms,
                next_id=2, minimum_iou=0.2,
            )
        self.assertEqual(active, [])
        self.assertEqual([item.region_id for item in archived], ["face-001"])

    def test_temporal_segments_merge_only_identical_adjacent_decisions(self):
        result = _merge_segments([
            {"atMs": 0, "template": "grid_3", "regionIds": ["face-1", "face-2", "face-3"]},
            {"atMs": 500, "template": "grid_3", "regionIds": ["face-1", "face-2", "face-3"]},
            {"atMs": 1_000, "template": "portrait_focus", "regionIds": ["face-1"]},
        ], 1_500)
        self.assertEqual(result, [
            {"startMs": 0, "endMs": 1_000, "template": "grid_3", "regionIds": ["face-1", "face-2", "face-3"], "transitionLatencyMs": 0},
            {"startMs": 1_000, "endMs": 1_500, "template": "portrait_focus", "regionIds": ["face-1"], "transitionLatencyMs": 0},
        ])


if __name__ == "__main__":
    unittest.main()
