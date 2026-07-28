import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.subtitles import ass_color, ass_time, write_ass


class SubtitleTests(unittest.TestCase):
    def test_ass_time(self):
        self.assertEqual(ass_time(3_723_450), "1:02:03.45")

    def test_ass_color_converts_rgb_to_bgr(self):
        self.assertEqual(ass_color("#10b8f4"), "&H00f4b810&")

    def test_write_ass_escapes_user_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "captions.ass"
            write_ass(path, [{"startMs": 0, "endMs": 1000, "text": "{test}"}], {}, 1080, 1920)
            content = path.read_text(encoding="utf-8")
            self.assertIn("\\{test\\}", content)


if __name__ == "__main__":
    unittest.main()
