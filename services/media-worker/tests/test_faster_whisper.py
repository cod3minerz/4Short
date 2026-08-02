import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.providers import _serialize_faster_whisper


class FasterWhisperSerializationTests(unittest.TestCase):
    def test_serializes_segments_and_word_timestamps(self):
        segments = [SimpleNamespace(
            start=0.0,
            end=2.5,
            text=" Привет, мир.",
            words=[
                SimpleNamespace(start=0.1, end=0.8, word=" Привет", probability=0.98),
                SimpleNamespace(start=1.0, end=1.5, word=" мир", probability=0.97),
            ],
        )]
        info = SimpleNamespace(language="ru", language_probability=0.99, duration=2.5)

        result = _serialize_faster_whisper(iter(segments), info)

        self.assertEqual(result["language"], "ru")
        self.assertEqual(result["text"], "Привет, мир.")
        self.assertEqual(result["segments"][0]["start"], 0.0)
        self.assertEqual(result["words"][0]["word"], "Привет")
        self.assertEqual(result["words"][1]["end"], 1.5)


if __name__ == "__main__":
    unittest.main()
