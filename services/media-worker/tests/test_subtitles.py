import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.fonts import apply_resolved_font_plan
from fourshort_worker.subtitles import ass_color, ass_time, write_ass, write_srt, write_vtt


class SubtitleTests(unittest.TestCase):
    def test_resolved_font_plan_overrides_editor_family(self):
        # Unit tests do not depend on the host's actual fontconfig package;
        # the worker integration check performs that availability assertion.
        from unittest.mock import patch
        with patch("fourshort_worker.fonts.installed_font_pack", return_value={"available": True}):
            config = apply_resolved_font_plan({"fontFamily": "Anything"}, {
                "id": "hve-sans-v1",
                "requestedFamily": "HVE Sans",
                "rendererFamily": "DejaVu Sans",
                "packVersion": "hve-font-pack-dejavu-2.37-1",
            })
        self.assertEqual(config["fontFamily"], "DejaVu Sans")

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

    def test_active_word_creates_precisely_timed_events(self):
        cue = {
            "id": "segment-1",
            "startMs": 100,
            "endMs": 1000,
            "text": "Привет мир",
            "words": [
                {"text": "Привет", "startMs": 100, "endMs": 450},
                {"text": "мир", "startMs": 500, "endMs": 1000},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "active.ass"
            write_ass(path, [cue], {"mode": "active_word", "activeColor": "#10b8f4"}, 1080, 1920)
            content = path.read_text(encoding="utf-8")
            self.assertIn("0:00:00.10,0:00:00.45", content)
            self.assertIn("0:00:00.50,0:00:01.00", content)
            self.assertIn("{\\c&H00f4b810&}Привет", content)

    def test_karaoke_uses_ass_karaoke_timing(self):
        cue = {
            "startMs": 0,
            "endMs": 1000,
            "text": "Раз два",
            "words": [
                {"text": "Раз", "startMs": 0, "endMs": 400},
                {"text": "два", "startMs": 500, "endMs": 1000},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "karaoke.ass"
            write_ass(path, [cue], {"mode": "karaoke"}, 1080, 1920)
            content = path.read_text(encoding="utf-8")
            self.assertIn("{\\kf40}Раз", content)
            self.assertIn("{\\k10}{\\kf50}два", content)

    def test_word_pop_has_a_real_output_clock_transform(self):
        cue = {
            "startMs": 0,
            "endMs": 1_000,
            "words": [
                {"text": "Сильная", "startMs": 0, "endMs": 400},
                {"text": "мысль", "startMs": 400, "endMs": 1_000},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "word-pop.ass"
            write_ass(path, [cue], {"mode": "word_by_word", "preset": "word_pop", "activeColor": "#10b8f4"}, 1080, 1920)
            content = path.read_text(encoding="utf-8")
            self.assertIn("\\fscx116\\fscy116\\t(0,80,\\fscx100\\fscy100)", content)
            self.assertIn("{\\c&H00f4b810&", content)
            self.assertIn("0:00:00.00,0:00:00.40", content)

    def test_every_public_and_legacy_caption_preset_has_renderer_semantics(self):
        """The picker names (and retained legacy Pulse) have ASS semantics.

        The media-worker render fixture exercises these presets through libass;
        this fast test makes the mapping reviewable even on hosts without that
        native filter.
        """
        cue = {
            "speakerId": "speaker-a", "startMs": 0, "endMs": 1_000,
            "words": [
                {"text": "Первая", "startMs": 0, "endMs": 500},
                {"text": "мысль", "startMs": 500, "endMs": 1_000},
            ],
        }
        presets = [
            ("clean", {"mode": "line", "preset": "clean"}, "Dialogue: 0"),
            ("bold", {"mode": "line", "preset": "bold"}, ",6,"),
            ("active_word", {"mode": "active_word", "preset": "clean"}, "\\c&H00f4b810&"),
            ("karaoke", {"mode": "karaoke", "preset": "karaoke"}, "\\kf50"),
            ("word_pop", {"mode": "word_by_word", "preset": "word_pop"}, "\\fscx116"),
            ("minimal_box", {"mode": "line", "preset": "minimal_box"}, ",&H99000000&,-1,0,0,0,100,100,0,0,3,"),
            ("speaker_colors", {"mode": "line", "preset": "speaker_colors"}, "\\c&H"),
            ("pulse", {"mode": "active_word", "preset": "pulse"}, "\\fscx112"),
        ]
        base = {
            "fontFamily": "DejaVu Sans", "fontSize": 40, "outlinePx": 2,
            "activeColor": "#10b8f4", "color": "#ffffff", "outlineColor": "#000000",
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, override, marker in presets:
                path = Path(directory) / f"{name}.ass"
                write_ass(path, [cue], base | override, 1080, 1920)
                self.assertIn(marker, path.read_text(encoding="utf-8"), name)

    def test_title_is_rendered_even_without_subtitle_cues(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "title.ass"
            write_ass(path, [], {}, 1080, 1920, {
                "text": "Главная мысль",
                "startMs": 0,
                "endMs": 2500,
                "anchor": "top_center",
            })
            content = path.read_text(encoding="utf-8")
            self.assertIn("Dialogue: 1,0:00:00.00,0:00:02.50,Title", content)
            self.assertIn("{\\an8}Главная мысль", content)

    def test_interchange_files_keep_resolved_clock_and_neutralize_vtt_delimiter(self):
        cues = [{
            "startMs": 105,
            "endMs": 2_010,
            "text": "Первая --> мысль\nВторая строка",
        }]
        with tempfile.TemporaryDirectory() as directory:
            srt = Path(directory) / "captions.srt"
            vtt = Path(directory) / "captions.vtt"
            write_srt(srt, cues)
            write_vtt(vtt, cues)
            self.assertEqual(
                srt.read_text(encoding="utf-8"),
                "1\n00:00:00,105 --> 00:00:02,010\nПервая → мысль\nВторая строка\n",
            )
            self.assertEqual(
                vtt.read_text(encoding="utf-8"),
                "WEBVTT\n\n00:00:00.105 --> 00:00:02.010\nПервая → мысль\nВторая строка\n",
            )


if __name__ == "__main__":
    unittest.main()
