import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.render import compile_video_filter


def edl_with_layout(layout: dict) -> dict:
    return {
        "export": {"width": 1080, "height": 1920},
        "layout": layout,
    }


class RenderFilterTests(unittest.TestCase):
    def test_blur_background_unchanged(self):
        chain = compile_video_filter(edl_with_layout({"mode": "blur_background"}), None)
        self.assertIn("boxblur=24:12", chain)

    def test_static_crop_default_matches_plain_centre_crop(self):
        chain = compile_video_filter(
            edl_with_layout({"mode": "static_crop", "x": 0.5, "y": 0.5, "zoom": 1}), None,
        )
        # x=0.5/y=0.5 puts the crop window exactly in the middle of the slack,
        # the same place the old unconditional centre-crop always used.
        self.assertIn("crop=1080:1920:'(iw-1080)*0.5':'(ih-1920)*0.5'", chain)
        self.assertIn("scale=1080:1920:force_original_aspect_ratio=increase", chain)

    def test_static_crop_honours_custom_position_and_zoom(self):
        chain = compile_video_filter(
            edl_with_layout({"mode": "static_crop", "x": 0.0, "y": 1.0, "zoom": 1.5}), None,
        )
        # zoom=1.5 scales the fill target up before cropping, so more of the
        # frame is excluded (a tighter, "zoomed in" crop).
        self.assertIn("scale=1620:2880:force_original_aspect_ratio=increase", chain)
        self.assertIn("crop=1080:1920:'(iw-1080)*0.0':'(ih-1920)*1.0'", chain)

    def test_static_crop_clamps_out_of_range_inputs(self):
        chain = compile_video_filter(
            edl_with_layout({"mode": "static_crop", "x": 2.0, "y": -1.0, "zoom": 0.2}), None,
        )
        self.assertIn("scale=1080:1920:force_original_aspect_ratio=increase", chain)  # zoom clamped to >= 1
        self.assertIn("crop=1080:1920:'(iw-1080)*1.0':'(ih-1920)*0.0'", chain)  # x/y clamped to [0, 1]

    def test_auto_mode_falls_back_to_plain_centre_crop(self):
        chain = compile_video_filter(edl_with_layout({"mode": "auto"}), None)
        self.assertIn("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v]", chain)

    def test_subtitles_ass_filter_appended_when_provided(self):
        chain = compile_video_filter(edl_with_layout({"mode": "auto"}), Path("/tmp/x.ass"))
        self.assertIn("ass='/tmp/x.ass'[outv]", chain)


if __name__ == "__main__":
    unittest.main()
