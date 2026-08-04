import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.providers import (
    _load_faster_whisper_model,
    _serialize_faster_whisper,
    FasterWhisperStt,
    faster_whisper_transcribe_options,
)
from fourshort_worker.errors import JobError


class FasterWhisperSerializationTests(unittest.TestCase):
    def test_cancelled_transcription_does_not_begin_audio_download(self):
        cancelled = threading.Event()
        cancelled.set()
        with TemporaryDirectory() as directory:
            provider = FasterWhisperStt(SimpleNamespace())
            with self.assertRaises(JobError) as context:
                provider.transcribe(
                    "https://example.invalid/audio.mp3",
                    "ru",
                    Path(directory),
                    cancellation_event=cancelled,
                )
        self.assertEqual(context.exception.code, "JOB_CANCELLED")

    def test_segment_stream_observes_cancellation_between_faster_whisper_batches(self):
        cancelled = threading.Event()
        segment = SimpleNamespace(
            start=0.0,
            end=1.0,
            text=" Привет",
            words=[],
        )
        info = SimpleNamespace(language="ru", language_probability=0.99, duration=2.0)

        def segments():
            yield segment
            cancelled.set()
            yield segment

        with self.assertRaises(JobError) as context:
            _serialize_faster_whisper(segments(), info, cancellation_event=cancelled)
        self.assertEqual(context.exception.code, "JOB_CANCELLED")

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
        self.assertEqual(result["words"][0]["id"], "0:0")
        self.assertEqual(result["words"][0]["startMs"], 100)
        self.assertEqual(result["words"][1]["end"], 1.5)

    def test_uses_the_same_configured_vad_policy_for_transcription(self):
        settings = SimpleNamespace(
            stt_beam_size=5,
            stt_vad_filter=True,
            stt_vad_min_silence_ms=650,
            stt_vad_speech_pad_ms=140,
        )

        options = faster_whisper_transcribe_options(settings, "ru")

        self.assertEqual(options["language"], "ru")
        self.assertTrue(options["word_timestamps"])
        self.assertEqual(options["vad_parameters"], {
            "min_silence_duration_ms": 650,
            "speech_pad_ms": 140,
        })

    def test_omits_vad_parameters_when_vad_is_disabled(self):
        settings = SimpleNamespace(
            stt_beam_size=3,
            stt_vad_filter=False,
            stt_vad_min_silence_ms=650,
            stt_vad_speech_pad_ms=140,
        )

        options = faster_whisper_transcribe_options(settings, "auto")

        self.assertIsNone(options["language"])
        self.assertFalse(options["vad_filter"])
        self.assertNotIn("vad_parameters", options)

    def test_model_loader_is_local_only_and_never_configures_a_download_cache(self):
        """A transcription job must not mutate or fetch a model at runtime."""
        captured = {}

        class FakeWhisperModel:
            def __init__(self, *args, **kwargs):
                captured["args"] = args
                captured["kwargs"] = kwargs

        _load_faster_whisper_model.cache_clear()
        with patch.dict(sys.modules, {"faster_whisper": SimpleNamespace(WhisperModel=FakeWhisperModel)}):
            _load_faster_whisper_model("/var/lib/4short/models/large-v3-turbo", "cpu", "int8", 8, 1)

        self.assertEqual(captured["args"], ("/var/lib/4short/models/large-v3-turbo",))
        self.assertTrue(captured["kwargs"]["local_files_only"])
        self.assertNotIn("download_root", captured["kwargs"])
        _load_faster_whisper_model.cache_clear()


if __name__ == "__main__":
    unittest.main()
