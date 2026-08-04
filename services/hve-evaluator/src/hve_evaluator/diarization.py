"""Sherpa-ONNX adapter that emits bounded HVE diarization evidence only."""

from __future__ import annotations

import wave
from pathlib import Path
from typing import Any

from .model_manifest import VerifiedEvaluatorModelSet


class DiarizationRuntimeError(RuntimeError):
    """A deliberate evaluator failure, never a production-worker fallback."""


def _read_pcm16_mono_16khz(audio_path: Path) -> tuple[Any, int]:
    try:
        with wave.open(str(audio_path), "rb") as handle:
            if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() != 16_000 or handle.getcomptype() != "NONE":
                raise DiarizationRuntimeError("diarization input must be a mono 16 kHz PCM16 WAV")
            frame_count = handle.getnframes()
            frames = handle.readframes(frame_count)
    except (OSError, wave.Error) as error:
        raise DiarizationRuntimeError("cannot read diarization WAV input") from error
    if not frames:
        raise DiarizationRuntimeError("diarization input has no PCM samples")
    try:
        import numpy
    except ImportError as error:
        raise DiarizationRuntimeError("NumPy is unavailable in this evaluator image") from error
    return numpy.frombuffer(frames, dtype="<i2").astype(numpy.float32) / 32768.0, frame_count


def run_sherpa_diarization(
    *,
    audio_path: Path,
    source_hash: str,
    duration_ms: int,
    model_set: VerifiedEvaluatorModelSet,
    max_speakers: int = 4,
) -> dict[str, Any]:
    """Run the documented offline Sherpa configuration for an evaluator item.

    Sherpa's diarization API does not expose calibrated turn confidence.  The
    evidence therefore records only its conservative segmentation acceptance
    floor (0.70), never an invented probability.  Promotion remains dependent
    on evaluator-owned labels and HVE-G5 metrics.
    """
    if duration_ms < 1 or not 1 <= max_speakers <= 4:
        raise DiarizationRuntimeError("duration and max speakers are outside evaluator bounds")
    try:
        import sherpa_onnx
    except ImportError as error:
        raise DiarizationRuntimeError("sherpa-onnx is unavailable in this evaluator image") from error

    segmentation = model_set.require("sherpa_segmentation")
    embedding = model_set.require("sherpa_embedding")
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation.path)),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(embedding.path)),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=0.5),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise DiarizationRuntimeError("Sherpa diarization configuration rejected the verified models")
    diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, frame_count = _read_pcm16_mono_16khz(audio_path)
    audio_duration_ms = frame_count * 1_000 / 16_000
    if abs(audio_duration_ms - duration_ms) > 1_500:
        raise DiarizationRuntimeError("source audio duration does not match the immutable source duration")
    if diarizer.sample_rate != 16_000:
        raise DiarizationRuntimeError("verified Sherpa diarizer did not request 16 kHz audio")
    try:
        result = diarizer.process(samples).sort_by_start_time()
    except Exception as error:  # third-party inference errors have no stable hierarchy
        raise DiarizationRuntimeError("Sherpa diarization did not complete") from error

    turns: list[dict[str, Any]] = []
    for segment in result:
        start_ms = max(0, int(round(float(segment.start) * 1_000)))
        end_ms = min(duration_ms, int(round(float(segment.end) * 1_000)))
        if end_ms <= start_ms:
            continue
        turns.append({
            "speakerId": f"sherpa-speaker-{int(segment.speaker):02d}",
            "startMs": start_ms,
            "endMs": end_ms,
            "confidence": 0.70,
        })
    if len({turn["speakerId"] for turn in turns}) > max_speakers:
        raise DiarizationRuntimeError("Sherpa candidate produced more speakers than the HVE evaluator supports")
    return {
        "schemaVersion": 1,
        "sourceHash": source_hash,
        "durationMs": duration_ms,
        "engine": "sherpa-onnx-offline-diarization",
        "modelVersion": f"sherpa-onnx-{getattr(sherpa_onnx, '__version__', 'unknown')}:{segmentation.version}+{embedding.version}",
        "turns": turns,
    }
