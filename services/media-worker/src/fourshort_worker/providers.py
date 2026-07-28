from __future__ import annotations

import json
import time
import httpx

from .config import Settings
from .errors import JobError


class YandexSpeechKit:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=60)

    def submit(self, audio_url: str, language: str = "auto") -> str:
        if not self.settings.yandex_cloud_api_key:
            raise JobError("STT_NOT_CONFIGURED", "SpeechKit credentials are missing", retryable=False)
        response = self.client.post(
            "https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync",
            headers={"Authorization": f"Api-Key {self.settings.yandex_cloud_api_key}"},
            json={
                "uri": audio_url,
                "recognitionModel": {
                    "model": "general",
                    "audioFormat": {"containerAudio": {"containerAudioType": "MP3"}},
                    "languageRestriction": {
                        "restrictionType": "WHITELIST",
                        "languageCode": [language],
                    },
                    "audioProcessingType": "FULL_DATA",
                },
            },
        )
        if response.status_code >= 500:
            raise JobError("STT_PROVIDER_UNAVAILABLE", "SpeechKit is unavailable", retryable=True)
        response.raise_for_status()
        return response.json()["id"]

    def wait(self, operation_id: str, timeout_seconds: int = 4 * 60 * 60) -> dict:
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
                return payload.get("response", {})
            time.sleep(5)
        raise JobError("STT_TIMEOUT", "SpeechKit recognition timed out", retryable=True)


class YandexGpt:
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
                "completionOptions": {
                    "stream": False,
                    "temperature": 0.2,
                    "maxTokens": str(max_tokens),
                },
                "messages": [
                    {"role": "system", "text": system},
                    {"role": "user", "text": prompt},
                ],
            },
        )
        if response.status_code >= 500:
            raise JobError("LLM_PROVIDER_UNAVAILABLE", "YandexGPT is unavailable", retryable=True)
        response.raise_for_status()
        text = response.json()["result"]["alternatives"][0]["message"]["text"]
        try:
            return json.loads(text.strip().removeprefix("```json").removesuffix("```").strip())
        except json.JSONDecodeError as error:
            raise JobError("LLM_INVALID_JSON", "YandexGPT returned invalid structured output", retryable=True) from error
