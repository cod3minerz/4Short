import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.media import create_browser_proxy, probe_media, verify_timed_brand_video


class BrowserProxyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg runtime is unavailable")
    def test_timed_brand_video_requires_decodable_h264_yuv420p(self):
        settings = SimpleNamespace(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe", ffmpeg_threads=1)
        with TemporaryDirectory() as directory:
            root = Path(directory)
            valid = root / "valid.mp4"
            unsupported = root / "unsupported.mp4"
            for path, pixel_format in ((valid, "yuv420p"), (unsupported, "yuv444p")):
                subprocess.run([
                    "ffmpeg", "-hide_banner", "-nostdin", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                    "-t", "1", "-c:v", "libx264", "-pix_fmt", pixel_format, "-c:a", "aac",
                    str(path),
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            facts = verify_timed_brand_video(settings, valid)
            self.assertEqual(facts["profile"], "hve-timed-visual-h264-aac-v1")
            self.assertEqual(facts["audioPolicy"], "muted_until_timed_audio_is_implemented")
            with self.assertRaisesRegex(ValueError, "HVE_TIMED_ASSET_PROFILE_UNSUPPORTED"):
                verify_timed_brand_video(settings, unsupported)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg runtime is unavailable")
    def test_proxy_is_a_bounded_h264_aac_mp4(self):
        settings = SimpleNamespace(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe", ffmpeg_threads=1)
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            output = root / "proxy.mp4"
            subprocess.run([
                "ffmpeg", "-hide_banner", "-nostdin", "-y",
                "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                str(source),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            metrics = create_browser_proxy(settings, str(source), output)
            probe = probe_media(settings, str(output))

            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 0)
            self.assertEqual(probe["video"]["codec_name"], "h264")
            self.assertEqual(probe["audio"]["codec_name"], "aac")
            self.assertTrue(probe["browserCompatible"])
            self.assertLessEqual(int(probe["video"]["width"]), 720)
            self.assertLessEqual(int(probe["video"]["height"]), 720)
            self.assertGreaterEqual(float(metrics.get("subprocessWallSeconds", 0)), 0)


if __name__ == "__main__":
    unittest.main()
