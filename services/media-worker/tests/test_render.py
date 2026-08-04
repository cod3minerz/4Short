import sys
from array import array
import shutil
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.media import _black_segments_from_ffmpeg_log, probe_media, validate_render
from fourshort_worker.render import _hve2_timeline_filter, _loudness_filter, build_hve2_keep_ranges, build_hve2_timeline, build_kept_ranges, compile_resolved_layout_filter, compile_video_filter, render_clip
from fourshort_worker.subtitles import write_ass


def has_ass_filter() -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    result = subprocess.run([ffmpeg, "-hide_banner", "-filters"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    return " ass " in result.stdout or " ass " in result.stderr


def edl_with_layout(layout: dict) -> dict:
    return {
        "export": {"width": 1080, "height": 1920},
        "layout": layout,
    }


class RenderFilterTests(unittest.TestCase):
    def test_blackdetect_log_parser_returns_bounded_output_clock_segments(self):
        log = "[blackdetect] black_start:0.000000 black_end:0.833333 black_duration:0.833333\n"
        self.assertEqual(_black_segments_from_ffmpeg_log(log), [{
            "startMs": 0, "endMs": 833, "durationMs": 833,
        }])
        self.assertEqual(_black_segments_from_ffmpeg_log("not an ffmpeg observation"), [])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_visual_integrity_observes_black_segment_without_invalidating_a_valid_render(self):
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        assert ffmpeg and ffprobe
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "black-then-red.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=160x90:r=30:d=1",
                "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=1",
                "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(output),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            validation = validate_render(
                SimpleNamespace(ffmpeg_path=ffmpeg, ffprobe_path=ffprobe),
                output,
                2_000,
                {"width": 160, "height": 90, "fps": 30},
                expect_audio=False,
            )
            self.assertTrue(validation["valid"], validation)
            self.assertEqual(validation["visualIntegrity"]["status"], "observed")
            self.assertTrue(validation["visualIntegrity"]["reviewRecommended"])
            self.assertGreaterEqual(validation["visualIntegrity"]["blackSegments"][0]["durationMs"], 750)

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

    def test_auto_mode_uses_dynamic_crop_track(self):
        edl = edl_with_layout({"mode": "auto"})
        edl["cropTrack"] = [
            {"atMs": 0, "x": 0.1, "y": 0.5, "width": 0.3, "height": 1.0},
            {"atMs": 1000, "x": 0.8, "y": 0.5, "width": 0.3, "height": 1.0},
        ]
        chain = compile_video_filter(edl, None)
        self.assertIn("crop='min(iw\\,ih*0.5625000000)'", chain)
        self.assertIn("0.700000", chain)
        self.assertIn("scale=1080:1920[v]", chain)

    def test_two_speakers_stacks_two_independent_tracks(self):
        edl = edl_with_layout({"mode": "two_speakers", "split": "horizontal"})
        edl["faceTracks"] = [
            {"trackId": 1, "keyframes": [{"atMs": 0, "x": 0.1, "y": 0.5}]},
            {"trackId": 2, "keyframes": [{"atMs": 0, "x": 0.9, "y": 0.5}]},
        ]
        chain = compile_video_filter(edl, None)
        self.assertIn("[0:v]split=2[faceA][faceB]", chain)
        self.assertIn("crop=1080:960", chain)
        self.assertIn("[top][bottom]vstack=inputs=2[v]", chain)

    def test_subtitles_ass_filter_appended_when_provided(self):
        chain = compile_video_filter(edl_with_layout({"mode": "auto"}), Path("/tmp/x.ass"))
        self.assertIn("ass='/tmp/x.ass'[outv]", chain)

    def test_resolved_v2_text_layer_uses_its_own_timing_geometry_and_opacity(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "layer.ass"
            write_ass(
                path,
                [],
                {"fontFamily": "Manrope"},
                1080,
                1920,
                production_text_layers=[{
                    "layerId": "layer-1",
                    "type": "text",
                    "outputRange": {"startUs": 1_000_000, "endUs": 2_750_000},
                    "destinationPx": {"x": 108, "y": 96, "width": 864, "height": 384},
                    "opacity": 0.8,
                    "zIndex": 10,
                    "text": "Проверяемый заголовок",
                    "style": {
                        "id": "hve-title-v1", "fontFamily": "Manrope", "fontSizePx": 66,
                        "fontWeight": 700, "color": "#ffffff", "outlineColor": "#06131a",
                        "outlinePx": 3, "background": True,
                    },
                }],
            )
            content = path.read_text(encoding="utf-8")
            self.assertIn("Dialogue: 12,0:00:01.00,0:00:02.75,Title", content)
            self.assertIn(r"\pos(108,96)\clip(108,96,972,480)", content)
            self.assertIn("Проверяемый заголовок", content)

    def test_resolved_v2_text_layer_rejects_out_of_canvas_geometry(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(ValueError, "HVE3_TEXT_LAYER_INVALID"):
                write_ass(
                    Path(temp_dir) / "bad.ass", [], {}, 1080, 1920,
                    production_text_layers=[{
                        "type": "text", "outputRange": {"startUs": 0, "endUs": 1_000_000},
                        "destinationPx": {"x": 1000, "y": 0, "width": 100, "height": 100},
                        "opacity": 1, "text": "bad", "style": {"id": "hve-title-v1"},
                    }],
                )

    def test_source_cuts_are_clamped_merged_and_converted_to_clip_relative_keep_ranges(self):
        edl = edl_with_layout({"mode": "auto"}) | {
            "range": {"startMs": 10_000, "endMs": 20_000},
            "cuts": [
                {"startMs": 9_000, "endMs": 12_000},
                {"startMs": 14_000, "endMs": 16_000},
                {"startMs": 15_000, "endMs": 18_000},
                {"startMs": 22_000, "endMs": 23_000},
            ],
        }
        self.assertEqual(build_kept_ranges(edl), [(2_000, 4_000), (8_000, 10_000)])

    def test_hve2_time_map_requires_one_contiguous_one_x_source_clock(self):
        map_entries = [
            {"sourceId": "source-a", "sourceRange": {"startUs": 2_000_100, "endUs": 3_000_100}, "outputRange": {"startUs": 0, "endUs": 1_000_000}, "rate": {"numerator": 1, "denominator": 1}},
            {"sourceId": "source-a", "sourceRange": {"startUs": 4_000_100, "endUs": 5_500_100}, "outputRange": {"startUs": 1_000_000, "endUs": 2_500_000}, "rate": {"numerator": 1, "denominator": 1}},
        ]
        self.assertEqual(build_hve2_keep_ranges(map_entries), (2_000_100, [(0, 1_000_000), (2_000_000, 3_500_000)]))
        with self.assertRaisesRegex(ValueError, "MULTI_SOURCE"):
            build_hve2_keep_ranges([map_entries[0], {**map_entries[1], "sourceId": "source-b"}])
        with self.assertRaisesRegex(ValueError, "RATE_CHANGE"):
            build_hve2_keep_ranges([{**map_entries[0], "rate": {"numerator": 2, "denominator": 1}}])

    def test_hve2_time_map_represents_crossfade_in_the_shared_output_clock(self):
        map_entries = [
            {"sourceId": "source-a", "sourceRange": {"startUs": 100_000, "endUs": 1_100_000}, "outputRange": {"startUs": 0, "endUs": 1_000_000}, "rate": {"numerator": 1, "denominator": 1}},
            {"sourceId": "source-a", "sourceRange": {"startUs": 2_100_000, "endUs": 3_100_000}, "outputRange": {"startUs": 970_000, "endUs": 1_970_000}, "rate": {"numerator": 1, "denominator": 1}, "transitionInUs": 30_000},
        ]
        seek_start_us, segments, output_duration_us = build_hve2_timeline(map_entries)
        self.assertEqual(seek_start_us, 100_000)
        self.assertEqual(output_duration_us, 1_970_000)
        self.assertEqual([(segment.start_us, segment.end_us, segment.transition_in_us) for segment in segments], [
            (0, 1_000_000, 0),
            (2_000_000, 3_000_000, 30_000),
        ])
        with self.assertRaisesRegex(ValueError, "CROSSFADE_KEEP_RANGE"):
            build_hve2_keep_ranges(map_entries)
        chain, video_input, audio_input = _hve2_timeline_filter(segments, True)
        self.assertEqual(video_input, "[timelinev]")
        self.assertEqual(audio_input, "[timelinea]")
        self.assertIn("xfade=transition=fade:duration=0.030000:offset=0.970000", chain)
        self.assertIn("acrossfade=d=0.030000:c1=tri:c2=tri", chain)

    def test_audio_policy_is_bounded_and_part_of_the_same_filter_graph(self):
        self.assertEqual(_loudness_filter("[timelinea]", {"targetLufs": -14, "truePeakDb": -1}), "[timelinea]loudnorm=I=-14:LRA=11:TP=-1[outa]")
        self.assertEqual(_loudness_filter("[timelinea]", {"targetLufs": -100, "truePeakDb": 5}), "[timelinea]loudnorm=I=-30:LRA=11:TP=0[outa]")

    def test_hve3_compositor_compiles_slots_from_resolved_geometry_without_template_branches(self):
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [
                {
                    "destinationPx": {"x": 0, "y": 0, "width": 540, "height": 1920},
                    "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"},
                    "fit": "cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                        {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                    ],
                },
                {
                    "destinationPx": {"x": 540, "y": 0, "width": 540, "height": 1920},
                    "source": {"kind": "source", "trackId": "secondary", "analysisId": "analysis"},
                    "fit": "contain",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
                        {"atUs": 999_999, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
                    ],
                },
            ],
        }]
        chain = compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None)
        self.assertIn("[timelinev]trim=start=0.000000:end=1.000000,setpts=PTS-STARTPTS[hve3segmentinput]", chain)
        self.assertIn("[hve3segmentinput]split=2[hve3slot0][hve3slot1]", chain)
        self.assertIn("crop='iw*0.50000000':'ih*1.00000000':'iw*(0.00000000)':'ih*(0.00000000)'", chain)
        self.assertIn("overlay=x=540+(540-w)/2:y=0+(1920-h)/2:shortest=1", chain)

    def test_hve3_compositor_compiles_static_asset_from_resolved_geometry_and_clock(self):
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [{
                "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 1920},
                "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"},
                "fit": "cover",
                "cropKeyframes": [
                    {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                ],
            }],
        }]
        chain = compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None, static_image_layers=[{
            "layerId": "asset-1", "type": "logo", "zIndex": 10, "opacity": 0.65,
            "path": "/tmp/logo.png", "destinationPx": {"x": 810, "y": 96, "width": 216, "height": 192},
            "outputRange": {"startUs": 200_000, "endUs": 900_000},
        }])
        self.assertIn("[1:v]scale=216:192:force_original_aspect_ratio=decrease", chain)
        self.assertIn("overlay=x=810+(216-w)/2:y=96+(192-h)/2:shortest=1:enable='between(t\\,0.200000\\,0.900000)'", chain)

    def test_hve3_compositor_keeps_global_z_order_across_static_and_timed_layers(self):
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [{
                "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 1920},
                "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"}, "fit": "cover",
                "cropKeyframes": [
                    {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                ],
            }],
        }]
        chain = compile_resolved_layout_filter(
            layout, {"width": 1080, "height": 1920, "fps": 30}, None,
            static_image_layers=[{
                "layerId": "logo-top", "type": "logo", "zIndex": 20, "opacity": 1,
                "path": "/tmp/logo.png", "destinationPx": {"x": 0, "y": 0, "width": 100, "height": 100},
                "outputRange": {"startUs": 0, "endUs": 1_000_000},
            }],
            timed_video_layers=[{
                "layerId": "video-bottom", "type": "video", "zIndex": 10, "opacity": 1, "loop": False,
                "path": "/tmp/overlay.mp4", "destinationPx": {"x": 0, "y": 0, "width": 100, "height": 100},
                "outputRange": {"startUs": 0, "endUs": 1_000_000},
            }],
        )
        self.assertLess(chain.index("[2:v]trim=duration=1.000000"), chain.index("[1:v]scale=100:100"))

    def test_hve8_compositor_rejects_partial_or_audible_broll(self):
        """The worker repeats planner safety checks before spawning FFmpeg."""
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [{
                "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 1920},
                "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"},
                "fit": "cover",
                "cropKeyframes": [
                    {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                ],
            }],
        }]
        broll = {
            "layerId": "broll-1", "type": "broll", "zIndex": 1, "opacity": 1,
            "muted": True, "visualPolicy": "replace_full_canvas_keep_narrative_audio", "fit": "cover",
            "path": "/tmp/broll.mp4", "outputRange": {"startUs": 100_000, "endUs": 900_000},
            "destinationPx": {"x": 0, "y": 0, "width": 1079, "height": 1920},
        }
        with self.assertRaisesRegex(ValueError, "HVE_BROLL_RENDER_POLICY_INVALID"):
            compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None, timed_video_layers=[broll])
        broll["destinationPx"] = {"x": 0, "y": 0, "width": 1080, "height": 1920}
        broll["muted"] = False
        with self.assertRaisesRegex(ValueError, "HVE_BROLL_RENDER_POLICY_INVALID"):
            compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None, timed_video_layers=[broll])

    def test_hve3_compositor_compiles_constant_size_dynamic_crop_on_output_clock(self):
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [{
                "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 1920},
                "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"},
                    "fit": "smart_cover",
                    "cropKeyframes": [
                    {"atUs": 0, "crop": {"x": 0.1, "y": 0, "width": 0.5, "height": 1}},
                    {"atUs": 999_999, "crop": {"x": 0.4, "y": 0, "width": 0.5, "height": 1}},
                ],
            }],
        }]
        chain = compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None)
        self.assertIn("if(lt(t\\,0.999999)", chain)
        self.assertIn("iw*(if(", chain)

    def test_hve6_user_verified_gameplay_composite_uses_generic_slot_compositor(self):
        """Facecam/top and gameplay/bottom are data slots, never a renderer mode."""
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [
                {
                    "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 576},
                    "source": {"kind": "source", "trackId": "source-facecam", "analysisId": "analysis"},
                    "fit": "smart_cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0.1, "y": 0, "width": 0.5, "height": 1}},
                        {"atUs": 999_999, "crop": {"x": 0.4, "y": 0, "width": 0.5, "height": 1}},
                    ],
                },
                {
                    "destinationPx": {"x": 0, "y": 576, "width": 1080, "height": 1344},
                    "source": {"kind": "source", "trackId": "source-screen", "analysisId": "analysis"},
                    "fit": "contain",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0.25, "width": 1, "height": 0.75}},
                        {"atUs": 999_999, "crop": {"x": 0, "y": 0.25, "width": 1, "height": 0.75}},
                    ],
                },
            ],
        }]
        chain = compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None)
        # HVE-3 normalises each contiguous layout segment onto the shared
        # output clock before splitting it into compositor slots. The old
        # assertion expected the pre-HVE-3 direct timeline split and would
        # miss a regression that removed this mandatory trim/setpts stage.
        self.assertIn("[hve3segmentinput]split=2[hve3slot0][hve3slot1]", chain)
        self.assertIn("overlay=x=0:y=0:shortest=1", chain)
        self.assertIn("overlay=x=0+(1080-w)/2:y=576+(1344-h)/2:shortest=1", chain)
        self.assertNotIn("gameplay_facecam", chain)

    def test_hve6_user_verified_grid_uses_generic_slot_compositor(self):
        """A 3-person panel is still ordinary explicit compositor data."""
        layout = [{
            "outputRange": {"startUs": 0, "endUs": 1_000_000},
            "slots": [
                {
                    "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 960},
                    "source": {"kind": "source", "trackId": "source-face-1", "analysisId": "analysis"},
                    "fit": "smart_cover",
                    "cropKeyframes": [{"atUs": 0, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}}, {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}}],
                },
                {
                    "destinationPx": {"x": 0, "y": 960, "width": 540, "height": 960},
                    "source": {"kind": "source", "trackId": "source-face-2", "analysisId": "analysis"},
                    "fit": "smart_cover",
                    "cropKeyframes": [{"atUs": 0, "crop": {"x": 0.25, "y": 0, "width": 0.5, "height": 1}}, {"atUs": 999_999, "crop": {"x": 0.25, "y": 0, "width": 0.5, "height": 1}}],
                },
                {
                    "destinationPx": {"x": 540, "y": 960, "width": 540, "height": 960},
                    "source": {"kind": "source", "trackId": "source-face-3", "analysisId": "analysis"},
                    "fit": "smart_cover",
                    "cropKeyframes": [{"atUs": 0, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}}, {"atUs": 999_999, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}}],
                },
            ],
        }]
        chain = compile_resolved_layout_filter(layout, {"width": 1080, "height": 1920, "fps": 30}, None)
        self.assertIn("[hve3segmentinput]split=3[hve3slot0][hve3slot1][hve3slot2]", chain)
        self.assertIn("overlay=x=0:y=0:shortest=1", chain)
        self.assertIn("overlay=x=0:y=960:shortest=1", chain)
        self.assertIn("overlay=x=540:y=960:shortest=1", chain)

    def test_hve3_compositor_refuses_dynamic_crop_size_or_incomplete_coverage(self):
        base_slot = {
            "destinationPx": {"x": 0, "y": 0, "width": 1080, "height": 1920},
            "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"},
            "fit": "smart_cover",
        }
        with self.assertRaisesRegex(ValueError, "DYNAMIC_CROP_SIZE"):
            compile_resolved_layout_filter([{
                "outputRange": {"startUs": 0, "endUs": 1_000_000},
                "slots": [{**base_slot, "cropKeyframes": [
                    {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    {"atUs": 999_999, "crop": {"x": 0.1, "y": 0, "width": 0.9, "height": 1}},
                ]}],
            }], {"width": 1080, "height": 1920, "fps": 30}, None)
        with self.assertRaisesRegex(ValueError, "COVERAGE"):
            compile_resolved_layout_filter([{
                "outputRange": {"startUs": 0, "endUs": 1_000_000},
                "slots": [{**base_slot, "cropKeyframes": [
                    {"atUs": 1, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                ]}],
            }], {"width": 1080, "height": 1920, "fps": 30}, None)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_source_cut_executes_as_full_decode_and_keeps_audio_in_sync(self):
        """A red / green / blue marker clip proves the middle A/V segment is gone."""
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        assert ffmpeg and ffprobe
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "color=c=green:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=1",
                "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:d=1",
                "-f", "lavfi", "-i", "sine=frequency=1760:sample_rate=48000:d=1",
                "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]",
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 3_000},
                "cuts": [{"startMs": 1_000, "endMs": 2_000}],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            metrics: dict[str, int | float] = {}
            rendered_ms = render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg),
                str(source), edl, None, output,
                has_audio=True,
                process_metrics=metrics,
            )
            self.assertEqual(rendered_ms, 2_000)
            self.assertGreater(metrics.get("subprocessPeakRssBytes", 0), 0)
            self.assertGreater(metrics.get("subprocessWallSeconds", 0), 0)
            validation = validate_render(
                SimpleNamespace(ffprobe_path=ffprobe, ffmpeg_path=ffmpeg),
                output,
                2_000,
                edl["export"],
                expect_audio=True,
            )
            self.assertTrue(validation["valid"], validation)
            self.assertEqual(validation["fullDecode"], "passed")
            self.assertIn(validation["visualIntegrity"]["status"], {"observed", "unavailable"})
            probe = probe_media(SimpleNamespace(ffprobe_path=ffprobe), str(output))
            self.assertIsNotNone(probe["audio"])
            self.assertLessEqual(abs(probe["durationMs"] - 2_000), 150)
            frame = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "1.25", "-i", str(output),
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            red, green, blue = frame[len(frame) // 2:len(frame) // 2 + 3]
            self.assertGreater(blue, red + 30)
            self.assertGreater(blue, green + 30)
            pcm = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "1.25", "-t", "0.20", "-i", str(output),
                "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            samples = array("h")
            samples.frombytes(pcm)
            zero_crossings = sum(1 for left, right in zip(samples, samples[1:]) if (left < 0 <= right) or (left >= 0 > right))
            detected_hz = zero_crossings / (2 * (len(samples) / 48_000))
            self.assertGreater(detected_hz, 1_500)
            self.assertLess(detected_hz, 2_000)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve2_time_map_executes_at_microsecond_boundaries(self):
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        assert ffmpeg and ffprobe
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "testsrc2=size=320x180:r=30:d=3",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=3",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {"range": {"startMs": 0, "endMs": 3_000}, "cuts": [], "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96}, "layout": {"mode": "auto"}}
            time_map = [
                {"sourceId": "source-a", "sourceRange": {"startUs": 100_100, "endUs": 800_100}, "outputRange": {"startUs": 0, "endUs": 700_000}, "rate": {"numerator": 1, "denominator": 1}},
                {"sourceId": "source-a", "sourceRange": {"startUs": 1_100_100, "endUs": 2_300_100}, "outputRange": {"startUs": 700_000, "endUs": 1_900_000}, "rate": {"numerator": 1, "denominator": 1}},
            ]
            rendered_ms = render_clip(SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=True, hve2_time_map=time_map)
            self.assertEqual(rendered_ms, 1_900)
            probe = probe_media(SimpleNamespace(ffprobe_path=ffprobe), str(output))
            self.assertIsNotNone(probe["audio"])
            self.assertLessEqual(abs(probe["durationMs"] - 1_900), 150)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve2_pause_crossfade_executes_video_and_audio_on_the_same_shortened_clock(self):
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        assert ffmpeg and ffprobe
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=1",
                "-f", "lavfi", "-i", "sine=frequency=1760:sample_rate=48000:d=1",
                "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]",
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            time_map = [
                {"sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 1_000_000}, "outputRange": {"startUs": 0, "endUs": 1_000_000}, "rate": {"numerator": 1, "denominator": 1}},
                {"sourceId": "source-a", "sourceRange": {"startUs": 1_000_000, "endUs": 2_000_000}, "outputRange": {"startUs": 900_000, "endUs": 1_900_000}, "rate": {"numerator": 1, "denominator": 1}, "transitionInUs": 100_000},
            ]
            rendered_ms = render_clip(SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=True, hve2_time_map=time_map)
            self.assertEqual(rendered_ms, 1_900)
            validation = validate_render(
                SimpleNamespace(ffmpeg_path=ffmpeg, ffprobe_path=ffprobe), output, 1_900, edl["export"], expect_audio=True,
            )
            self.assertTrue(validation["valid"], validation)
            probe = probe_media(SimpleNamespace(ffprobe_path=ffprobe), str(output))
            self.assertIsNotNone(probe["audio"])
            self.assertLessEqual(abs(probe["durationMs"] - 1_900), 150)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve3_resolved_slot_compositor_executes_geometry_with_full_decode(self):
        """One source, two explicit crops: left stays red and right stays blue."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=160x180:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=blue:s=160x180:r=30:d=2",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=2",
                "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]",
                "-map", "[v]", "-map", "2:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            resolved_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [
                    {
                        "destinationPx": {"x": 0, "y": 0, "width": 90, "height": 320},
                        "source": {"kind": "source", "trackId": "left", "analysisId": "analysis"}, "fit": "cover",
                        "cropKeyframes": [
                            {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                            {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                        ],
                    },
                    {
                        "destinationPx": {"x": 90, "y": 0, "width": 90, "height": 320},
                        "source": {"kind": "source", "trackId": "right", "analysisId": "analysis"}, "fit": "cover",
                        "cropKeyframes": [
                            {"atUs": 0, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
                            {"atUs": 1_999_999, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
                        ],
                    },
                ],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=True,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }], resolved_layout_segments=resolved_layout,
            )
            frame = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "0.5", "-i", str(output),
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            left_offset = (160 * 180 + 45) * 3
            right_offset = (160 * 180 + 135) * 3
            left = frame[left_offset:left_offset + 3]
            right = frame[right_offset:right_offset + 3]
            self.assertGreater(left[0], left[2] + 50)
            self.assertGreater(right[2], right[0] + 50)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve3_verified_static_logo_is_burned_only_in_its_output_range(self):
        """A static asset is a real HVE layer, not an editor-only descriptor."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            logo = root / "logo.png"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2",
                "-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=40x40:r=1:d=1",
                "-frames:v", "1", str(logo),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            resolved_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [{
                    "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                    "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"}, "fit": "cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                        {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    ],
                }],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }],
                resolved_layout_segments=resolved_layout,
                static_image_layers=[{
                    "layerId": "logo-1", "type": "logo", "zIndex": 10, "opacity": 1,
                    "path": str(logo), "destinationPx": {"x": 120, "y": 20, "width": 40, "height": 40},
                    "outputRange": {"startUs": 200_000, "endUs": 900_000},
                }],
            )

            def red_at(at_seconds: str) -> int:
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-vf", "crop=20:20:130:30", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                return sum(1 for index in range(0, len(frame), 3) if frame[index] > frame[index + 2] + 50)

            self.assertGreater(red_at("0.45"), 200)
            self.assertLess(red_at("1.20"), 10)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve3_verified_timed_video_is_a_muted_overlay_at_its_output_range(self):
        """Timed visual media begins at its layer clock and cannot shorten the clip."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            overlay = root / "overlay.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=2",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=50x40:r=30:d=1",
                "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:d=1",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(overlay),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            resolved_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [{
                    "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                    "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"}, "fit": "cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                        {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    ],
                }],
            }]
            timed_layer = {
                "layerId": "video-1", "type": "video", "zIndex": 10, "opacity": 1, "loop": False,
                "path": str(overlay), "destinationPx": {"x": 120, "y": 20, "width": 50, "height": 40},
                "outputRange": {"startUs": 400_000, "endUs": 1_400_000},
            }
            filter_graph = compile_resolved_layout_filter(
                resolved_layout, edl["export"], None, "[timelinev]", timed_video_layers=[timed_layer],
            )
            self.assertIn("[1:v]trim=duration=1.000000", filter_graph)
            self.assertNotIn("[1:a]", filter_graph)
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=True,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }],
                resolved_layout_segments=resolved_layout,
                timed_video_layers=[timed_layer],
            )

            def red_at(at_seconds: str) -> int:
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-vf", "crop=20:20:130:30", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                return sum(1 for index in range(0, len(frame), 3) if frame[index] > frame[index + 2] + 50)

            probe = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(output), "-f", "null", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(probe.returncode, 0)
            self.assertGreater(red_at("0.70"), 200)
            self.assertLess(red_at("1.70"), 10)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve3_timed_video_loop_repeats_visual_input_without_extending_clip_clock(self):
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            overlay = root / "overlay.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2",
                "-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=50x40:r=30:d=0.35",
                "-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(overlay),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [{
                    "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                    "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"}, "fit": "cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                        {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    ],
                }],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }],
                resolved_layout_segments=layout,
                timed_video_layers=[{
                    "layerId": "video-loop", "type": "video", "zIndex": 10, "opacity": 1, "loop": True,
                    "path": str(overlay), "destinationPx": {"x": 120, "y": 20, "width": 50, "height": 40},
                    "outputRange": {"startUs": 400_000, "endUs": 1_400_000},
                }],
            )

            def red_at(at_seconds: str) -> int:
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-vf", "crop=20:20:130:30", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                return sum(1 for index in range(0, len(frame), 3) if frame[index] > frame[index + 2] + 50)

            self.assertGreater(red_at("1.10"), 200)
            self.assertLess(red_at("1.70"), 10)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve8_broll_replaces_only_visuals_and_preserves_narrative_audio(self):
        """B-roll has a distinct policy: full-canvas visual replacement, never audio mixing."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            broll = root / "broll.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=blue:s=180x320:r=30:d=2",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=2",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=1",
                "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:d=1",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(broll),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [{
                    "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                    "source": {"kind": "source", "trackId": "primary", "analysisId": "analysis"}, "fit": "cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                        {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 1}},
                    ],
                }],
            }]
            broll_layer = {
                "layerId": "broll-1", "type": "broll", "zIndex": 0, "opacity": 1, "muted": True,
                "visualPolicy": "replace_full_canvas_keep_narrative_audio", "fit": "cover", "path": str(broll),
                "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                "outputRange": {"startUs": 500_000, "endUs": 1_500_000},
            }
            filter_graph = compile_resolved_layout_filter(layout, edl["export"], None, "[timelinev]", timed_video_layers=[broll_layer])
            self.assertIn("force_original_aspect_ratio=increase,crop=180:320", filter_graph)
            self.assertNotIn("[1:a]", filter_graph)
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=True,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }],
                resolved_layout_segments=layout,
                timed_video_layers=[broll_layer],
            )

            def average_rgb(at_seconds: str) -> tuple[float, float, float]:
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                pixels = len(frame) // 3
                return tuple(sum(frame[index::3]) / pixels for index in range(3))

            before, during, after = average_rgb("0.25"), average_rgb("0.90"), average_rgb("1.75")
            self.assertGreater(before[2], before[0] + 60)
            self.assertGreater(during[0], during[2] + 60)
            self.assertGreater(after[2], after[0] + 60)
            pcm = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "0.7", "-i", str(output), "-t", "0.25",
                "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            samples = array("h")
            samples.frombytes(pcm)
            crossings = sum(
                1 for left, right in zip(samples, samples[1:])
                if (left < 0 <= right) or (left >= 0 > right)
            )
            # 440 Hz source audio makes about 220 sign crossings in 0.25s;
            # an accidental 880 Hz B-roll mix would be roughly double.
            self.assertLess(crossings, 360)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve6_user_verified_gameplay_composite_executes_top_and_bottom_slots(self):
        """The generic compositor really emits facecam/top and screen/bottom pixels."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=2",
                "-filter_complex", "[0:v][1:v]vstack=inputs=2[v]",
                "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            gameplay_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [
                    {
                        "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 96},
                        "source": {"kind": "source", "trackId": "source-facecam", "analysisId": "analysis"},
                        "fit": "smart_cover",
                        "cropKeyframes": [
                            {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1, "height": 0.5}},
                            {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 1, "height": 0.5}},
                        ],
                    },
                    {
                        "destinationPx": {"x": 0, "y": 96, "width": 180, "height": 224},
                        "source": {"kind": "source", "trackId": "source-screen", "analysisId": "analysis"},
                        "fit": "contain",
                        "cropKeyframes": [
                            {"atUs": 0, "crop": {"x": 0, "y": 0.5, "width": 1, "height": 0.5}},
                            {"atUs": 1_999_999, "crop": {"x": 0, "y": 0.5, "width": 1, "height": 0.5}},
                        ],
                    },
                ],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }], resolved_layout_segments=gameplay_layout,
            )
            frame = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "0.5", "-i", str(output),
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            def pixel(x: int, y: int) -> bytes:
                offset = (y * 180 + x) * 3
                return frame[offset:offset + 3]
            top = pixel(90, 48)
            bottom = pixel(90, 208)
            self.assertGreater(top[0], top[2] + 50)
            self.assertGreater(bottom[2], bottom[0] + 50)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve6_user_verified_three_person_grid_executes_all_slots(self):
        """The generic compositor actually paints all three verified grid slots."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=80x120:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=green:s=80x120:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=blue:s=80x120:r=30:d=2",
                "-filter_complex", "[0:v][1:v][2:v]hstack=inputs=3[v]",
                "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            grid_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [
                    {
                        "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 160},
                        "source": {"kind": "source", "trackId": "source-face-1", "analysisId": "analysis"}, "fit": "smart_cover",
                        "cropKeyframes": [{"atUs": 0, "crop": {"x": 0, "y": 0, "width": 1 / 3, "height": 1}}, {"atUs": 1_999_999, "crop": {"x": 0, "y": 0, "width": 1 / 3, "height": 1}}],
                    },
                    {
                        "destinationPx": {"x": 0, "y": 160, "width": 90, "height": 160},
                        "source": {"kind": "source", "trackId": "source-face-2", "analysisId": "analysis"}, "fit": "smart_cover",
                        "cropKeyframes": [{"atUs": 0, "crop": {"x": 1 / 3, "y": 0, "width": 1 / 3, "height": 1}}, {"atUs": 1_999_999, "crop": {"x": 1 / 3, "y": 0, "width": 1 / 3, "height": 1}}],
                    },
                    {
                        "destinationPx": {"x": 90, "y": 160, "width": 90, "height": 160},
                        "source": {"kind": "source", "trackId": "source-face-3", "analysisId": "analysis"}, "fit": "smart_cover",
                        "cropKeyframes": [{"atUs": 0, "crop": {"x": 2 / 3, "y": 0, "width": 1 / 3, "height": 1}}, {"atUs": 1_999_999, "crop": {"x": 2 / 3, "y": 0, "width": 1 / 3, "height": 1}}],
                    },
                ],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }], resolved_layout_segments=grid_layout,
            )
            frame = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "0.5", "-i", str(output),
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            def pixel(x: int, y: int) -> bytes:
                offset = (y * 180 + x) * 3
                return frame[offset:offset + 3]
            top, bottom_left, bottom_right = pixel(90, 80), pixel(45, 240), pixel(135, 240)
            self.assertGreater(top[0], top[1] + 50)
            self.assertGreater(bottom_left[1], bottom_left[0] + 35)
            self.assertGreater(bottom_right[2], bottom_right[0] + 50)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve6_user_verified_four_person_grid_executes_all_slots(self):
        """A four-person grid also stays generic compositor data, not a new renderer."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=80x60:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=green:s=80x60:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=blue:s=80x60:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=yellow:s=80x60:r=30:d=2",
                "-filter_complex", "[0:v][1:v]hstack[top];[2:v][3:v]hstack[bottom];[top][bottom]vstack[v]",
                "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            crop_values = [(0, 0), (0.5, 0), (0, 0.5), (0.5, 0.5)]
            grid_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [
                    {
                        "destinationPx": {"x": (index % 2) * 90, "y": (index // 2) * 160, "width": 90, "height": 160},
                        "source": {"kind": "source", "trackId": f"source-face-{index + 1}", "analysisId": "analysis"}, "fit": "smart_cover",
                        "cropKeyframes": [
                            {"atUs": 0, "crop": {"x": crop_x, "y": crop_y, "width": 0.5, "height": 0.5}},
                            {"atUs": 1_999_999, "crop": {"x": crop_x, "y": crop_y, "width": 0.5, "height": 0.5}},
                        ],
                    }
                    for index, (crop_x, crop_y) in enumerate(crop_values)
                ],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }], resolved_layout_segments=grid_layout,
            )
            frame = subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-ss", "0.5", "-i", str(output),
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            def pixel(x: int, y: int) -> bytes:
                offset = (y * 180 + x) * 3
                return frame[offset:offset + 3]
            top_left, top_right = pixel(45, 80), pixel(135, 80)
            bottom_left, bottom_right = pixel(45, 240), pixel(135, 240)
            self.assertGreater(top_left[0], top_left[1] + 50)
            self.assertGreater(top_right[1], top_right[0] + 35)
            self.assertGreater(bottom_left[2], bottom_left[0] + 50)
            self.assertGreater(bottom_right[0], bottom_right[2] + 50)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve3_dynamic_crop_moves_across_verified_output_clock(self):
        """A red→blue crop trajectory proves the executor does not freeze frame 0."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=160x180:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=blue:s=160x180:r=30:d=2",
                "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]",
                "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            resolved_layout = [{
                "outputRange": {"startUs": 0, "endUs": 2_000_000},
                "slots": [{
                    "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                    "source": {"kind": "source", "trackId": "manual-window", "analysisId": "analysis"},
                    "fit": "cover",
                    "cropKeyframes": [
                        {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                        {"atUs": 1_999_999, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
                    ],
                }],
            }]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }], resolved_layout_segments=resolved_layout,
            )

            def centre_rgb(at_seconds: str) -> bytes:
                return subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-vf", "crop=2:2:90:160", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout[:3]

            early = centre_rgb("0.20")
            late = centre_rgb("1.75")
            self.assertGreater(early[0], early[2] + 50)
            self.assertGreater(late[2], late[0] + 50)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_hve3_contiguous_layout_segments_switch_on_the_shared_output_clock(self):
        """Two verified layouts may hard-cut without changing narrative audio/time.

        The source has a permanent red left half and blue right half.  The
        first output-clock segment resolves the left crop; the second starts
        on that same left crop and moves to the right. Decoding the final MP4
        at both points proves the compositor did not merely validate two
        planner records or evaluate the second segment's absolute keyframes on
        its segment-local FFmpeg clock.
        """
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=2",
                "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=2",
                "-filter_complex", "[0:v][1:v]hstack=inputs=2",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            edl = {
                "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
                "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
                "layout": {"mode": "auto"},
            }
            resolved_layout = [
                {
                    "outputRange": {"startUs": 0, "endUs": 1_000_000},
                    "slots": [{
                        "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                        "source": {"kind": "source", "trackId": "left", "analysisId": "analysis"}, "fit": "cover",
                        "cropKeyframes": [
                            {"atUs": 0, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                            {"atUs": 999_999, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                        ],
                    }],
                },
                {
                    "outputRange": {"startUs": 1_000_000, "endUs": 2_000_000},
                    "slots": [{
                        "destinationPx": {"x": 0, "y": 0, "width": 180, "height": 320},
                        "source": {"kind": "source", "trackId": "right", "analysisId": "analysis"}, "fit": "cover",
                        "cropKeyframes": [
                            {"atUs": 1_000_000, "crop": {"x": 0, "y": 0, "width": 0.5, "height": 1}},
                            {"atUs": 1_999_999, "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1}},
                        ],
                    }],
                },
            ]
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, None, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }], resolved_layout_segments=resolved_layout,
            )

            def centre_rgb(at_seconds: str) -> bytes:
                return subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-vf", "crop=2:2:90:160", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout[:3]

            first = centre_rgb("0.35")
            second_start = centre_rgb("1.15")
            second_end = centre_rgb("1.85")
            self.assertGreater(first[0], first[2] + 50)
            self.assertGreater(second_start[0], second_start[2] + 50)
            self.assertGreater(second_end[2], second_end[0] + 50)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe") and has_ass_filter(), "ffmpeg with libass and ffprobe are required")
    def test_hve2_output_timed_captions_are_burned_after_source_cuts(self):
        """A black source makes a decoded subtitle pixel test deterministic."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            ass = root / "captions.ass"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=3",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=3",
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            subtitles = {
                "enabled": True, "mode": "active_word", "preset": "clean", "fontFamily": "DejaVu Sans",
                "fontSize": 34, "fontWeight": 700, "uppercase": False, "maxWordsPerLine": 4,
                "position": "bottom", "safeMarginPx": 26, "color": "#ffffff", "activeColor": "#10b8f4",
                "outlineColor": "#000000", "outlinePx": 2, "background": False,
            }
            # These are already on HVE's output clock.  The second cue begins
            # after the removed 800.1ms–1.1001s source interval, so checking
            # both ranges proves the renderer consumes output-timed captions
            # alongside the stitched A/V timeline (rather than source times).
            write_ass(ass, [
                {
                    "id": "cue-1", "text": "готово", "startMs": 100, "endMs": 600,
                    "words": [{"id": "word-1", "text": "готово", "startMs": 100, "endMs": 600}],
                },
                {
                    "id": "cue-2", "text": "после склейки", "startMs": 850, "endMs": 1_300,
                    "words": [{"id": "word-2", "text": "после склейки", "startMs": 850, "endMs": 1_300}],
                },
            ], subtitles, 180, 320)
            edl = {"range": {"startMs": 0, "endMs": 3_000}, "cuts": [], "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96}, "layout": {"mode": "auto"}}
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, ass, output, has_audio=True,
                hve2_time_map=[
                    {"sourceId": "source-a", "sourceRange": {"startUs": 100_100, "endUs": 800_100}, "outputRange": {"startUs": 0, "endUs": 700_000}, "rate": {"numerator": 1, "denominator": 1}},
                    {"sourceId": "source-a", "sourceRange": {"startUs": 1_100_100, "endUs": 2_300_100}, "outputRange": {"startUs": 700_000, "endUs": 1_900_000}, "rate": {"numerator": 1, "denominator": 1}},
                ],
                audio_policy={"targetLufs": -14, "truePeakDb": -1},
            )
            def caption_pixels(at_seconds: str) -> int:
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                # The source is black. The lower half contains the bottom
                # caption safe area, so bright pixels are deterministic visual
                # evidence of a burned cue rather than an ASS sidecar alone.
                lower_half = frame[(180 * 160 * 3):]
                return sum(
                    1 for index in range(0, len(lower_half), 3)
                    if max(lower_half[index:index + 3]) > 160
                )

            self.assertGreater(caption_pixels("0.35"), 40)
            # No caption may leak into the output gap between the two cues.
            self.assertLess(caption_pixels("0.75"), 8)
            # This cue is after the source cut on the stitched output clock.
            self.assertGreater(caption_pixels("1.00"), 40)
            self.assertLess(caption_pixels("1.55"), 8)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe") and has_ass_filter(), "ffmpeg with libass and ffprobe are required")
    def test_hve2_public_and_legacy_caption_presets_produce_visible_burned_output(self):
        """Every public treatment (plus retained legacy Pulse) must become media.

        This is deliberately a small deterministic fixture rather than an
        approval-quality visual corpus.  It catches the dangerous regression
        where a preset still serializes an ASS file but no longer reaches the
        final MP4.  G2 remains insufficient until the separate corpus/golden
        evidence exists.
        """
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        presets = [
            ("clean", {"mode": "line", "preset": "clean"}, None),
            ("bold", {"mode": "line", "preset": "bold"}, None),
            ("active_word", {"mode": "active_word", "preset": "clean"}, "\\c&H00f4b810&"),
            ("karaoke", {"mode": "karaoke", "preset": "karaoke"}, "\\kf"),
            ("word_pop", {"mode": "word_by_word", "preset": "word_pop"}, "\\fscx116"),
            # BorderStyle=3 and the opaque back colour distinguish the box
            # treatment from a default outlined line caption.
            ("minimal_box", {"mode": "line", "preset": "minimal_box"}, ",&H99000000&,-1,0,0,0,100,100,0,0,3,"),
            ("speaker_colors", {"mode": "line", "preset": "speaker_colors"}, "\\c&H"),
            # ``pulse`` remains a backwards-compatible saved preset and
            # must retain the same actual animation treatment as Word Pop.
            ("pulse", {"mode": "active_word", "preset": "pulse"}, "\\fscx112"),
        ]
        base_subtitles = {
            "enabled": True, "fontFamily": "DejaVu Sans", "fontSize": 34,
            "fontWeight": 700, "uppercase": False, "maxWordsPerLine": 4,
            "position": "bottom", "safeMarginPx": 26, "color": "#ffffff",
            "activeColor": "#10b8f4", "outlineColor": "#000000",
            "outlinePx": 2, "background": False,
        }
        cue = {
            "id": "preset-cue", "speakerId": "speaker-a", "text": "проверяем стиль",
            "startMs": 200, "endMs": 1_500,
            "words": [
                {"id": "word-1", "text": "проверяем", "startMs": 200, "endMs": 800},
                {"id": "word-2", "text": "стиль", "startMs": 800, "endMs": 1_500},
            ],
        }
        hve2_time_map = [{
            "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
            "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
        }]
        edl = {
            "range": {"startMs": 0, "endMs": 2_000}, "cuts": [],
            "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96},
            "layout": {"mode": "auto"},
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2",
                "-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            for name, override, expected_ass in presets:
                ass = root / f"{name}.ass"
                output = root / f"{name}.mp4"
                config = base_subtitles | override
                write_ass(ass, [cue], config, 180, 320)
                ass_content = ass.read_text(encoding="utf-8")
                if expected_ass:
                    self.assertIn(expected_ass, ass_content, name)
                render_clip(
                    SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, ass, output, has_audio=False,
                    hve2_time_map=hve2_time_map,
                )
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", "0.55", "-i", str(output),
                    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                # The source is pure black.  Bright pixels establish that the
                # caption treatment made it into decoded video output.
                visible_pixels = sum(
                    1 for index in range(0, len(frame), 3)
                    if max(frame[index:index + 3]) > 160
                )
                self.assertGreater(visible_pixels, 40, name)

    @unittest.skipUnless(shutil.which("ffmpeg") and has_ass_filter(), "ffmpeg with libass is required")
    def test_hve3_resolved_text_layer_is_burned_at_its_resolved_output_time(self):
        """A V2 title is actual composited media, not an editor-only plan."""
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.mp4"
            output = root / "output.mp4"
            ass = root / "title.ass"
            subprocess.run([
                ffmpeg, "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2",
                "-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            write_ass(
                ass, [], {"fontFamily": "DejaVu Sans"}, 180, 320,
                production_text_layers=[{
                    "layerId": "title-1", "type": "text",
                    "outputRange": {"startUs": 200_000, "endUs": 900_000},
                    "destinationPx": {"x": 10, "y": 10, "width": 160, "height": 100},
                    "opacity": 1, "zIndex": 10, "text": "TITLE",
                    "style": {
                        "id": "hve-title-v1", "fontFamily": "DejaVu Sans", "fontSizePx": 34,
                        "fontWeight": 700, "color": "#ffffff", "outlineColor": "#000000",
                        "outlinePx": 2, "background": False,
                    },
                }],
            )
            edl = {"range": {"startMs": 0, "endMs": 2_000}, "cuts": [], "export": {"width": 180, "height": 320, "fps": 30, "videoBitrateKbps": 1_200, "audioBitrateKbps": 96}, "layout": {"mode": "auto"}}
            render_clip(
                SimpleNamespace(ffmpeg_path=ffmpeg), str(source), edl, ass, output, has_audio=False,
                hve2_time_map=[{
                    "sourceId": "source-a", "sourceRange": {"startUs": 0, "endUs": 2_000_000},
                    "outputRange": {"startUs": 0, "endUs": 2_000_000}, "rate": {"numerator": 1, "denominator": 1},
                }],
            )

            def bright_top_pixels(at_seconds: str) -> int:
                frame = subprocess.run([
                    ffmpeg, "-hide_banner", "-nostdin", "-ss", at_seconds, "-i", str(output),
                    "-frames:v", "1", "-vf", "crop=180:120:0:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                return sum(1 for index in range(0, len(frame), 3) if max(frame[index:index + 3]) > 160)

            self.assertGreater(bright_top_pixels("0.45"), 40)
            self.assertLess(bright_top_pixels("1.20"), 8)


if __name__ == "__main__":
    unittest.main()
