from __future__ import annotations

from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
import json
import threading
import httpx

from .config import Settings
from .errors import JobError
from .model_assets import verify_local_stt_model
from .provider_policy import validate_llm_model


def _assert_not_cancelled(cancellation_event: threading.Event | None) -> None:
    """Stop at safe provider boundaries after a worker lost its lease.

    Faster-Whisper exposes decoded segments lazily, which gives us a bounded
    cancellation point between inference batches. HTTP providers do not offer
    a portable cancellation hook for an in-flight request, so they are checked
    immediately before dispatch and immediately after the response instead.
    """
    if cancellation_event is not None and cancellation_event.is_set():
        raise JobError("JOB_CANCELLED", "Job lease was cancelled or reassigned during provider work", retryable=False)


def _json_payload(text: str, provider: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```")
        cleaned = cleaned.removesuffix("```").strip()
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise JobError("LLM_INVALID_JSON", f"{provider} returned invalid structured output", retryable=True) from error
    if not isinstance(payload, dict):
        raise JobError("LLM_INVALID_JSON", f"{provider} returned a non-object JSON value", retryable=True)
    return payload


class SpeechToTextProvider(ABC):
    name: str

    @abstractmethod
    def transcribe(
        self,
        audio_url: str,
        language: str,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        raise NotImplementedError


class JsonLlmProvider(ABC):
    name: str

    @abstractmethod
    def complete_json(
        self,
        model: str,
        system: str,
        prompt: str,
        max_tokens: int = 4000,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        raise NotImplementedError


@lru_cache(maxsize=2)
def _load_faster_whisper_model(
    model_path: str,
    device: str,
    compute_type: str,
    cpu_threads: int,
    num_workers: int,
):
    # Imported lazily so lightweight jobs and unit tests do not load the
    # CTranslate2 runtime or allocate model memory.
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_path,
        device=device,
        compute_type=compute_type,
        cpu_threads=cpu_threads,
        num_workers=num_workers,
        # `model_path` is a verified local directory. Do not pass a model
        # name or download_root: production transcription must be offline and
        # must not mutate a model cache while a user waits for a job.
        local_files_only=True,
    )


def _serialize_faster_whisper(segments, info, *, cancellation_event: threading.Event | None = None) -> dict:
    serialized_segments: list[dict] = []
    serialized_words: list[dict] = []
    text_parts: list[str] = []

    for index, segment in enumerate(segments):
        _assert_not_cancelled(cancellation_event)
        text = str(segment.text).strip()
        text_parts.append(text)
        serialized_segments.append({
            "id": index,
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
        })
        for word_index, word in enumerate(segment.words or []):
            _assert_not_cancelled(cancellation_event)
            if word.start is None or word.end is None:
                continue
            clean_word = str(word.word).strip()
            serialized_words.append({
                "id": f"{index}:{word_index}",
                "segmentIndex": index,
                "wordIndex": word_index,
                "word": clean_word,
                "text": clean_word,
                "start": float(word.start),
                "end": float(word.end),
                "startMs": round(float(word.start) * 1000),
                "endMs": round(float(word.end) * 1000),
                "probability": float(word.probability),
            })

    return {
        "task": "transcribe",
        "language": info.language,
        "language_probability": float(info.language_probability),
        "duration": float(info.duration),
        "text": " ".join(part for part in text_parts if part),
        "segments": serialized_segments,
        "words": serialized_words,
    }


def _speech_intervals(
    audio_path: Path,
    minimum_silence_ms: int,
    speech_pad_ms: int,
    *,
    cancellation_event: threading.Event | None = None,
) -> list[dict]:
    """Return the same Silero-VAD regions Faster-Whisper uses internally."""
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    _assert_not_cancelled(cancellation_event)
    sample_rate = 16_000
    audio = decode_audio(str(audio_path), sampling_rate=sample_rate)
    _assert_not_cancelled(cancellation_event)
    options = VadOptions(
        min_silence_duration_ms=minimum_silence_ms,
        speech_pad_ms=speech_pad_ms,
    )
    regions = get_speech_timestamps(audio, options, sampling_rate=sample_rate)
    _assert_not_cancelled(cancellation_event)
    return [
        {
            "startMs": round(int(region["start"]) / sample_rate * 1000),
            "endMs": round(int(region["end"]) / sample_rate * 1000),
        }
        for region in regions
        if int(region["end"]) > int(region["start"])
    ]


def faster_whisper_transcribe_options(settings: Settings, language: str) -> dict:
    """Build the single STT/VAD policy used by transcription and HVE facts.

    Without explicit ``vad_parameters``, Faster-Whisper uses its own defaults
    while the separately persisted speech intervals use product settings. That
    disagreement can move pause-removal boundaries away from transcript words.
    """
    options: dict = {
        "language": None if language == "auto" else language,
        "beam_size": settings.stt_beam_size,
        "word_timestamps": True,
        "vad_filter": settings.stt_vad_filter,
        "condition_on_previous_text": True,
    }
    if settings.stt_vad_filter:
        options["vad_parameters"] = {
            "min_silence_duration_ms": settings.stt_vad_min_silence_ms,
            "speech_pad_ms": settings.stt_vad_speech_pad_ms,
        }
    return options


class FasterWhisperStt(SpeechToTextProvider):
    name = "faster_whisper_large_v3_turbo"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=httpx.Timeout(4 * 60 * 60, connect=30))

    def transcribe(
        self,
        audio_url: str,
        language: str,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        _assert_not_cancelled(cancellation_event)
        audio_path = job_dir / "whisper-audio.mp3"
        try:
            with self.client.stream("GET", audio_url) as source:
                source.raise_for_status()
                with audio_path.open("wb") as target:
                    for chunk in source.iter_bytes(1024 * 1024):
                        _assert_not_cancelled(cancellation_event)
                        target.write(chunk)
        except (httpx.HTTPError, OSError) as error:
            raise JobError("STT_AUDIO_DOWNLOAD_FAILED", "Could not load audio for local transcription", retryable=True) from error

        try:
            _assert_not_cancelled(cancellation_event)
            verified_model = verify_local_stt_model(self.settings)
            model = _load_faster_whisper_model(
                str(verified_model.path),
                self.settings.stt_device,
                self.settings.stt_compute_type,
                self.settings.stt_cpu_threads,
                self.settings.stt_num_workers,
            )
            segments, info = model.transcribe(
                str(audio_path),
                **faster_whisper_transcribe_options(self.settings, language),
            )
            response = _serialize_faster_whisper(segments, info, cancellation_event=cancellation_event)
            if self.settings.stt_vad_filter:
                response["speechIntervals"] = _speech_intervals(
                    audio_path,
                    self.settings.stt_vad_min_silence_ms,
                    self.settings.stt_vad_speech_pad_ms,
                    cancellation_event=cancellation_event,
                )
            _assert_not_cancelled(cancellation_event)
            return {"response": response}
        except JobError:
            raise
        except Exception as error:
            raise JobError("STT_FAILED", "Local Faster-Whisper transcription failed", retryable=True) from error


class OpenRouterLlm(JsonLlmProvider):
    name = "openrouter"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=180)

    def _validate_model(self, model: str) -> None:
        validate_llm_model(model, self.settings.allowed_llm_models, self.settings.blocked_llm_prefixes)

    def complete_json(
        self,
        model: str,
        system: str,
        prompt: str,
        max_tokens: int = 4000,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        _assert_not_cancelled(cancellation_event)
        self._validate_model(model)
        if not self.settings.openrouter_api_key:
            raise JobError("LLM_NOT_CONFIGURED", "OpenRouter credentials are missing", retryable=False)
        try:
            response = self.client.post(
                self.settings.openrouter_base_url.rstrip("/") + "/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                    "HTTP-Referer": self.settings.control_api_url,
                    "X-Title": "4Short",
                },
                json={
                    "model": model,
                    "temperature": 0.15,
                    "max_tokens": max_tokens,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "provider": {
                        "allow_fallbacks": True,
                        "require_parameters": True,
                        "data_collection": "deny",
                        "zdr": True,
                        "sort": "price",
                    },
                },
            )
        except httpx.HTTPError as error:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "OpenRouter is unavailable", retryable=True) from error
        _assert_not_cancelled(cancellation_event)
        if response.status_code >= 500 or response.status_code == 429:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "OpenRouter is unavailable", retryable=True)
        if response.status_code >= 400:
            raise JobError("LLM_REQUEST_REJECTED", "OpenRouter rejected the configured model or privacy policy", retryable=False)
        payload = response.json()
        return _json_payload(payload["choices"][0]["message"]["content"], self.name)


class DeepSeekLlm(JsonLlmProvider):
    name = "deepseek"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=180)

    def complete_json(
        self,
        model: str,
        system: str,
        prompt: str,
        max_tokens: int = 4000,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        _assert_not_cancelled(cancellation_event)
        if not self.settings.deepseek_api_key:
            raise JobError("LLM_NOT_CONFIGURED", "DeepSeek credentials are missing", retryable=False)
        provider_model = model.split("/", 1)[-1]
        try:
            response = self.client.post(
                self.settings.deepseek_base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.deepseek_api_key}"},
                json={
                    "model": provider_model,
                    "temperature": 0.15,
                    "max_tokens": max_tokens,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
        except httpx.HTTPError as error:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "DeepSeek is unavailable", retryable=True) from error
        _assert_not_cancelled(cancellation_event)
        if response.status_code >= 500 or response.status_code == 429:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "DeepSeek is unavailable", retryable=True)
        if response.status_code >= 400:
            raise JobError("LLM_REQUEST_REJECTED", "DeepSeek rejected the request", retryable=False)
        payload = response.json()
        return _json_payload(payload["choices"][0]["message"]["content"], self.name)


def create_llm_provider(settings: Settings) -> JsonLlmProvider:
    if settings.llm_provider == "openrouter":
        return OpenRouterLlm(settings)
    if settings.llm_provider == "deepseek":
        return DeepSeekLlm(settings)
    raise JobError("LLM_PROVIDER_DENIED", f"Unknown LLM provider: {settings.llm_provider}", retryable=False)
