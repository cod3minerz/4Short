from __future__ import annotations

from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
import json
import time
import httpx

from .config import Settings
from .errors import JobError
from .provider_policy import validate_llm_model


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
    def transcribe(self, audio_url: str, language: str, job_dir: Path) -> dict:
        raise NotImplementedError


class JsonLlmProvider(ABC):
    name: str

    @abstractmethod
    def complete_json(self, model: str, system: str, prompt: str, max_tokens: int = 4000) -> dict:
        raise NotImplementedError


class YandexSpeechKit(SpeechToTextProvider):
    name = "yandex_speechkit_v3"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=60)

    def _submit(self, audio_url: str, language: str = "auto") -> str:
        if not self.settings.yandex_cloud_api_key:
            raise JobError("STT_NOT_CONFIGURED", "SpeechKit credentials are missing", retryable=False)
        language_restriction = {"restrictionType": "WHITELIST", "languageCode": [language]}
        if language == "auto":
            language_restriction = {"restrictionType": "WHITELIST", "languageCode": ["ru-RU", "en-US"]}
        response = self.client.post(
            "https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync",
            headers={"Authorization": f"Api-Key {self.settings.yandex_cloud_api_key}"},
            json={
                "uri": audio_url,
                "recognitionModel": {
                    "model": "general",
                    "audioFormat": {"containerAudio": {"containerAudioType": "MP3"}},
                    "languageRestriction": language_restriction,
                    "audioProcessingType": "FULL_DATA",
                },
            },
        )
        if response.status_code >= 500:
            raise JobError("STT_PROVIDER_UNAVAILABLE", "SpeechKit is unavailable", retryable=True)
        response.raise_for_status()
        return response.json()["id"]

    def _wait(self, operation_id: str, timeout_seconds: int = 4 * 60 * 60) -> dict:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            response = self.client.get(
                "https://operation.api.cloud.yandex.net/operations/" + operation_id,
                headers={"Authorization": f"Api-Key {self.settings.yandex_cloud_api_key}"},
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("done"):
                if payload.get("error"):
                    raise JobError("STT_FAILED", "SpeechKit recognition failed", retryable=False, details=payload["error"])
                return {"operationId": operation_id, "response": payload.get("response", {})}
            time.sleep(5)
        raise JobError("STT_TIMEOUT", "SpeechKit recognition timed out", retryable=True)

    def transcribe(self, audio_url: str, language: str, job_dir: Path) -> dict:
        del job_dir
        return self._wait(self._submit(audio_url, language))


class OpenAICompatibleStt(SpeechToTextProvider):
    """
    Adapter for non-OpenAI providers exposing the common multipart transcription
    contract. The configured model is still checked by our explicit allowlist.
    """

    name = "compatible_stt"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=httpx.Timeout(4 * 60 * 60, connect=30))

    def transcribe(self, audio_url: str, language: str, job_dir: Path) -> dict:
        if not self.settings.stt_api_key or not self.settings.stt_base_url or not self.settings.stt_model:
            raise JobError("STT_NOT_CONFIGURED", "External STT adapter is missing URL, key or model", retryable=False)
        audio_path = job_dir / "provider-audio.mp3"
        with self.client.stream("GET", audio_url) as source:
            source.raise_for_status()
            with audio_path.open("wb") as target:
                for chunk in source.iter_bytes(1024 * 1024):
                    target.write(chunk)
        data = {"model": self.settings.stt_model, "response_format": "verbose_json"}
        if language != "auto":
            data["language"] = language
        with audio_path.open("rb") as audio:
            response = self.client.post(
                self.settings.stt_base_url.rstrip("/") + "/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.settings.stt_api_key}"},
                data=data,
                files={"file": ("audio.mp3", audio, "audio/mpeg")},
            )
        if response.status_code >= 500 or response.status_code == 429:
            raise JobError("STT_PROVIDER_UNAVAILABLE", "External STT provider is unavailable", retryable=True)
        if response.status_code >= 400:
            raise JobError("STT_FAILED", "External STT provider rejected audio", retryable=False)
        return {"response": response.json()}


@lru_cache(maxsize=2)
def _load_faster_whisper_model(
    model_name: str,
    device: str,
    compute_type: str,
    cpu_threads: int,
    num_workers: int,
    download_root: str,
):
    # Imported lazily so lightweight jobs and unit tests do not load the
    # CTranslate2 runtime or allocate model memory.
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        cpu_threads=cpu_threads,
        num_workers=num_workers,
        download_root=download_root,
    )


def _serialize_faster_whisper(segments, info) -> dict:
    serialized_segments: list[dict] = []
    serialized_words: list[dict] = []
    text_parts: list[str] = []

    for index, segment in enumerate(segments):
        text = str(segment.text).strip()
        text_parts.append(text)
        serialized_segments.append({
            "id": index,
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
        })
        for word in segment.words or []:
            if word.start is None or word.end is None:
                continue
            serialized_words.append({
                "word": str(word.word).strip(),
                "start": float(word.start),
                "end": float(word.end),
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


class FasterWhisperStt(SpeechToTextProvider):
    name = "faster_whisper_large_v3_turbo"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=httpx.Timeout(4 * 60 * 60, connect=30))

    def transcribe(self, audio_url: str, language: str, job_dir: Path) -> dict:
        audio_path = job_dir / "whisper-audio.mp3"
        try:
            with self.client.stream("GET", audio_url) as source:
                source.raise_for_status()
                with audio_path.open("wb") as target:
                    for chunk in source.iter_bytes(1024 * 1024):
                        target.write(chunk)
        except (httpx.HTTPError, OSError) as error:
            raise JobError("STT_AUDIO_DOWNLOAD_FAILED", "Could not load audio for local transcription", retryable=True) from error

        self.settings.stt_model_cache.mkdir(parents=True, exist_ok=True)
        try:
            model = _load_faster_whisper_model(
                self.settings.stt_model,
                self.settings.stt_device,
                self.settings.stt_compute_type,
                self.settings.stt_cpu_threads,
                self.settings.stt_num_workers,
                str(self.settings.stt_model_cache),
            )
            segments, info = model.transcribe(
                str(audio_path),
                language=None if language == "auto" else language,
                beam_size=self.settings.stt_beam_size,
                word_timestamps=True,
                vad_filter=self.settings.stt_vad_filter,
                condition_on_previous_text=True,
            )
            return {"response": _serialize_faster_whisper(segments, info)}
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

    def complete_json(self, model: str, system: str, prompt: str, max_tokens: int = 4000) -> dict:
        self._validate_model(model)
        if not self.settings.openrouter_api_key:
            raise JobError("LLM_NOT_CONFIGURED", "OpenRouter credentials are missing", retryable=False)
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

    def complete_json(self, model: str, system: str, prompt: str, max_tokens: int = 4000) -> dict:
        if not self.settings.deepseek_api_key:
            raise JobError("LLM_NOT_CONFIGURED", "DeepSeek credentials are missing", retryable=False)
        provider_model = model.split("/", 1)[-1]
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
        if response.status_code >= 500 or response.status_code == 429:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "DeepSeek is unavailable", retryable=True)
        if response.status_code >= 400:
            raise JobError("LLM_REQUEST_REJECTED", "DeepSeek rejected the request", retryable=False)
        payload = response.json()
        return _json_payload(payload["choices"][0]["message"]["content"], self.name)


class YandexGpt(JsonLlmProvider):
    name = "yandexgpt"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=120)

    def complete_json(self, model: str, system: str, prompt: str, max_tokens: int = 4000) -> dict:
        if not self.settings.yandex_cloud_api_key or not self.settings.yandex_cloud_folder_id:
            raise JobError("LLM_NOT_CONFIGURED", "YandexGPT credentials are missing", retryable=False)
        response = self.client.post(
            "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
            headers={
                "Authorization": f"Api-Key {self.settings.yandex_cloud_api_key}",
                "x-folder-id": self.settings.yandex_cloud_folder_id,
            },
            json={
                "modelUri": f"gpt://{self.settings.yandex_cloud_folder_id}/{model}",
                "completionOptions": {"stream": False, "temperature": 0.15, "maxTokens": str(max_tokens)},
                "messages": [{"role": "system", "text": system}, {"role": "user", "text": prompt}],
            },
        )
        if response.status_code >= 500:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "YandexGPT is unavailable", retryable=True)
        response.raise_for_status()
        return _json_payload(response.json()["result"]["alternatives"][0]["message"]["text"], self.name)


def create_stt_provider(settings: Settings) -> SpeechToTextProvider:
    if settings.stt_provider == "faster_whisper":
        return FasterWhisperStt(settings)
    if settings.stt_provider == "yandex_speechkit":
        return YandexSpeechKit(settings)
    if settings.stt_provider == "compatible":
        return OpenAICompatibleStt(settings)
    raise JobError("STT_PROVIDER_DENIED", f"Unknown STT provider: {settings.stt_provider}", retryable=False)


def create_llm_provider(settings: Settings) -> JsonLlmProvider:
    if settings.llm_provider == "openrouter":
        return OpenRouterLlm(settings)
    if settings.llm_provider == "deepseek":
        return DeepSeekLlm(settings)
    if settings.llm_provider == "yandex":
        return YandexGpt(settings)
    raise JobError("LLM_PROVIDER_DENIED", f"Unknown LLM provider: {settings.llm_provider}", retryable=False)
