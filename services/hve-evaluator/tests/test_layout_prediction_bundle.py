import hashlib
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from hve_evaluator.layout_prediction_bundle import LayoutPredictionBundleError, build_layout_prediction_bundle


HASH = "a" * 64


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def artifact(source_hash=HASH):
    value = {
        "schemaVersion": 1,
        "kind": "hve-layout-candidate-run-v1",
        "sourceHash": source_hash,
        "durationMs": 4_000,
        "candidate": {
            "regionDetector": "hve-cv-structure-baseline", "regionModelVersion": "builtin-opencv-v1", "regionModelSha256": "b" * 64,
            "faceDetector": "mediapipe-face-landmarker", "faceModelVersion": "test-v1", "faceModelSha256": "c" * 64,
            "directorVersion": "hve-layout-director-baseline-v1", "directorCodeSha256": "b" * 64,
        },
        "regions": [
            {"regionId": "structure-001", "kind": "structure_candidate", "range": {"startMs": 0, "endMs": 4_000}, "box": {"x": 0, "y": 0, "width": 1, "height": 0.7}, "observations": 8, "confidence": 0.7},
            {"regionId": "face-001", "kind": "face_candidate", "range": {"startMs": 0, "endMs": 4_000}, "box": {"x": 0.2, "y": 0.7, "width": 0.2, "height": 0.2}, "observations": 8, "confidence": 0.7},
        ],
        "segments": [{"startMs": 0, "endMs": 4_000, "template": "screen_speaker", "regionIds": ["structure-001", "face-001"], "transitionLatencyMs": 250}],
        "measurement": {"scope": "cgroup-v2", "peakRssBytes": 100_000_000, "sustainedSwapBytes": 0, "wallSeconds": 3.0, "mediaSeconds": 4.0, "coldStartSeconds": 0.5},
    }
    value["artifactSha256"] = hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()
    return value


class LayoutPredictionBundleTests(unittest.TestCase):
    def setup_files(self, root: Path, candidate=None):
        candidate = candidate or artifact()
        candidate_path = root / "candidate" / "screen-01" / "layout-candidate.json"
        candidate_path.parent.mkdir(parents=True)
        candidate_path.write_text(canonical(candidate), encoding="utf-8")
        mapping = {
            "schemaVersion": 1,
            "kind": "hve-layout-director-evaluator-mapping-v1",
            "items": [{
                "itemId": "screen-01", "sourceHash": candidate["sourceHash"], "candidateArtifactSha256": candidate["artifactSha256"],
                "regions": {"structure-001": "gold-screen", "face-001": "gold-face"},
                "ranges": [{"rangeId": "range-1", "startUs": 0, "endUs": 4_000_000}],
            }],
        }
        mapping_path = root / "mapping.json"; mapping_path.write_text(canonical(mapping), encoding="utf-8")
        hardware_path = root / "hardware.json"; hardware_path.write_text(canonical({"profile": "timeweb-cpu8-12gb", "cpuCount": 8, "memoryBytes": 12 * 1024 ** 3}), encoding="utf-8")
        return mapping_path, root / "candidate", hardware_path

    def test_builds_predictions_only_from_hashed_candidate_artifact_and_exact_range(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            mapping, candidate_root, hardware = self.setup_files(root)
            bundle = build_layout_prediction_bundle(
                mapping_path=mapping, candidate_root=candidate_root, corpus_version="layout-v1", manifest_sha256="d" * 64,
                object_index_sha256="e" * 64, evaluator_key_fingerprint="f" * 64, hardware_path=hardware,
            )
            self.assertEqual(bundle["candidate"]["regionDetector"], "hve-cv-structure-baseline")
            decision = bundle["items"][0]["decisions"][0]
            self.assertEqual(decision["template"], "screen_speaker")
            self.assertEqual(decision["range"], {"startUs": 0, "endUs": 4_000_000})
            self.assertEqual(decision["regions"], [
                {"regionId": "structure-001", "visibleAreaRatio": 1.0},
                {"regionId": "face-001", "visibleAreaRatio": 1.0},
            ])

    def test_rejects_candidate_artifact_changed_after_hashing(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = artifact(); candidate["segments"][0]["template"] = "grid_3"
            mapping, candidate_root, hardware = self.setup_files(root, candidate)
            with self.assertRaisesRegex(LayoutPredictionBundleError, "changed after hashing"):
                build_layout_prediction_bundle(
                    mapping_path=mapping, candidate_root=candidate_root, corpus_version="layout-v1", manifest_sha256="d" * 64,
                    object_index_sha256="e" * 64, evaluator_key_fingerprint="f" * 64, hardware_path=hardware,
                )

    def test_rejects_host_only_measurement_even_when_other_evidence_is_valid(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = artifact(); candidate["measurement"]["scope"] = "process-fallback"
            unhashed = dict(candidate); unhashed.pop("artifactSha256")
            candidate["artifactSha256"] = hashlib.sha256(canonical(unhashed).encode("utf-8")).hexdigest()
            mapping, candidate_root, hardware = self.setup_files(root, candidate)
            with self.assertRaisesRegex(LayoutPredictionBundleError, "cgroup-v2"):
                build_layout_prediction_bundle(
                    mapping_path=mapping, candidate_root=candidate_root, corpus_version="layout-v1", manifest_sha256="d" * 64,
                    object_index_sha256="e" * 64, evaluator_key_fingerprint="f" * 64, hardware_path=hardware,
                )


if __name__ == "__main__":
    unittest.main()
