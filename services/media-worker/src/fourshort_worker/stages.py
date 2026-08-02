from __future__ import annotations

from pathlib import Path
import hashlib
import json
import subprocess
import time

from .config import Settings
from .control_api import Job
from .errors import JobError
from .media import extract_audio, probe_media, validate_render
from .moments import (
    chunk_transcript,
    compact_transcript,
    deterministic_candidates,
    normalize_candidates,
    settings_json,
    transcript_text,
)
from .providers import FasterWhisperStt, create_llm_provider
from .render import render_clip
from .storage import Storage
from .subtitles import write_ass


class StageRunner:
    def __init__(self, settings: Settings, storage: Storage):
        self.settings = settings
        self.storage = storage

    def source_url(self, payload: dict) -> str:
        source = payload.get("source") or payload.get("input")
        if not isinstance(source, dict):
            raise JobError("SOURCE_MISSING", "Job has no source", retryable=False)
        if source.get("kind") == "s3":
            return self.storage.signed_get(source["bucket"], source["key"], expires=4 * 60 * 60)
        if source.get("url") and str(source["url"]).startswith("https://"):
            return str(source["url"])
        raise JobError("SOURCE_INVALID", "Unsupported source locator", retryable=False)

    def run(self, job: Job, job_dir: Path) -> tuple[dict, dict]:
        started = time.monotonic()
        if job.type == "probe":
            result = self.probe(job)
        elif job.type == "youtube_import":
            result = self.youtube_import(job)
        elif job.type == "extract_audio":
            result = self.extract_audio(job, job_dir)
        elif job.type == "speech_to_text":
            result = self.speech_to_text(job, job_dir)
        elif job.type == "find_moments":
            result = self.find_moments(job)
        elif job.type == "render_clip":
            result = self.render(job, job_dir)
        elif job.type == "validate_render":
            result = self.validate(job, job_dir)
        elif job.type == "face_track":
            result = self.face_track(job)
        elif job.type in {"zip_project", "cleanup"}:
            raise JobError("STAGE_NOT_ENABLED", f"{job.type} adapter is not enabled on this worker image", retryable=False)
        else:
            raise JobError("UNKNOWN_JOB_TYPE", f"Unknown job type: {job.type}", retryable=False)
        return result, {"wallSeconds": round(time.monotonic() - started, 3)}

    def probe(self, job: Job) -> dict:
        source = job.payload["source"]
        url = self.source_url(job.payload)
        result = probe_media(self.settings, url)
        if source.get("kind") == "s3":
            result["fingerprint"] = self.storage.sha256_object(source["bucket"], source["key"])
        return result

    def youtube_import(self, job: Job) -> dict:
        url = str(job.payload.get("source", {}).get("url", ""))
        hostname = url.split("/", 3)[2].lower() if url.startswith("https://") else ""
        # Mirrors SUPPORTED_SOURCE_HOSTS in packages/contracts/src/api.ts — yt-dlp
        # itself handles all four extractors; this whitelist exists so an
        # arbitrary URL can't be smuggled through as an "import".
        allowed_hosts = {
            "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
            "vk.com", "www.vk.com", "vkvideo.ru", "www.vkvideo.ru",
            "rutube.ru", "www.rutube.ru",
            "twitch.tv", "www.twitch.tv", "clips.twitch.tv", "m.twitch.tv",
        }
        if hostname not in allowed_hosts:
            raise JobError("IMPORT_DOMAIN_DENIED", "Import is only allowed from YouTube, VK, RuTube or Twitch", retryable=False)
        key = self.settings.object_key("raw", f"{job.workspace_id}/{job.payload['sourceId']}/source.mp4")
        process = subprocess.Popen(
            [
                self.settings.ytdlp_path,
                "--no-playlist",
                "--no-progress",
                "--no-warnings",
                "--format", "best[ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[ext=mp4]",
                "--output", "-",
                url,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
        )
        if process.stdout is None:
            raise JobError("IMPORT_PIPE_FAILED", "Could not open YouTube import stream", retryable=True)

        class HashingReader:
            def __init__(self, raw):
                self.raw = raw
                self.digest = hashlib.sha256()

            def read(self, size=-1):
                chunk = self.raw.read(size)
                if chunk:
                    self.digest.update(chunk)
                return chunk

        reader = HashingReader(process.stdout)
        try:
            artifact = self.storage.upload_stream(
                reader,
                self.settings.effective_raw_bucket,
                key,
                "video/mp4",
            )
        except Exception as error:
            process.kill()
            raise JobError("YOUTUBE_IMPORT_UPLOAD_FAILED", "Could not persist imported video", retryable=True) from error
        stderr = process.stderr.read().decode("utf-8", errors="replace")[-2000:] if process.stderr else ""
        return_code = process.wait(timeout=60)
        if return_code != 0:
            raise JobError(
                "YOUTUBE_IMPORT_FAILED",
                "YouTube did not provide a compatible video stream",
                retryable=return_code in {1, 2},
                details={"returnCode": return_code, "stderr": stderr},
            )
        source_url = self.storage.signed_get(artifact["bucket"], artifact["key"], expires=3600)
        probe = probe_media(self.settings, source_url)
        return {**artifact, **probe, "fingerprint": reader.digest.hexdigest()}

    def extract_audio(self, job: Job, job_dir: Path) -> dict:
        output = job_dir / "audio.mp3"
        extract_audio(self.settings, self.source_url(job.payload), output)
        key = self.settings.object_key(
            "derived",
            f"{job.workspace_id}/{job.project_id}/{job.id}/audio.mp3",
        )
        artifact = self.storage.upload_file(
            output,
            self.settings.effective_derived_bucket,
            key,
            "audio/mpeg",
        )
        artifact["expiresInHours"] = 24
        return {"audio": artifact}

    def speech_to_text(self, job: Job, job_dir: Path) -> dict:
        audio = job.payload["audio"]
        url = self.storage.signed_get(audio["bucket"], audio["key"], expires=4 * 60 * 60)
        provider = FasterWhisperStt(self.settings)
        result = provider.transcribe(url, job.payload.get("language", "auto"), job_dir)
        return {"provider": provider.name, **result}

    def find_moments(self, job: Job) -> dict:
        transcript = job.payload["transcript"]
        settings = job.payload["settings"]
        segments = compact_transcript(transcript)
        deterministic = deterministic_candidates(segments, settings)
        if deterministic is not None:
            return {"candidates": deterministic, "provider": "deterministic", "models": {}}
        system = (
            "Ты редактор коротких видео. Верни только JSON с массивом candidates. "
            "Каждый кандидат содержит startMs, endMs, title, topic, explanation, score от 0 до 100. "
            "Используй только таймкоды из транскрипта. Фрагмент должен быть самостоятельным, "
            "завершённым и не обещать просмотры."
        )
        provider = create_llm_provider(self.settings)
        candidate_model = self.settings.llm_candidate_model
        rerank_model = self.settings.llm_rerank_model
        candidates: list[dict] = []
        for chunk in chunk_transcript(segments):
            prompt = (
                f"Настройки: {settings_json(settings)}\n\n"
                f"Транскрипт с таймкодами в миллисекундах:\n{transcript_text(chunk)}"
            )
            response = provider.complete_json(candidate_model, system, prompt)
            if isinstance(response.get("candidates"), list):
                candidates.extend(response["candidates"])
        if not candidates:
            raise JobError("MOMENTS_NOT_FOUND", "The model returned no usable moment candidates", retryable=True)
        rerank_prompt = (
            f"Настройки: {settings_json(settings)}\n"
            "Удалите дубли, сохраните сильнейшие фрагменты и разнообразие тем. "
            f"Кандидаты: {json.dumps(candidates[:200], ensure_ascii=False, separators=(',', ':'))}"
        )
        ranked = provider.complete_json(rerank_model, system, rerank_prompt)
        normalized = normalize_candidates(ranked.get("candidates", candidates), segments, settings)
        if not normalized:
            normalized = normalize_candidates(candidates, segments, settings)
        if not normalized:
            raise JobError("MOMENTS_INVALID", "The model returned invalid moment ranges", retryable=True)
        return {
            "candidates": normalized,
            "provider": provider.name,
            "models": {"candidate": candidate_model, "rerank": rerank_model},
        }

    def face_track(self, job: Job) -> dict:
        # The safe result is intentional: the renderer can continue without a
        # face model and the UI receives a warning instead of a failed series.
        # A model-enabled image replaces this handler without changing EDL/API.
        return {
            "cropTrack": [],
            "fallback": "static_crop",
            "warnings": ["FACE_MODEL_NOT_INSTALLED"],
        }

    def render(self, job: Job, job_dir: Path) -> dict:
        edl = job.payload["edl"]
        ass_path = None
        cues = job.payload.get("subtitleCues", [])
        if edl["subtitles"].get("enabled") and cues:
            ass_path = job_dir / "subtitles.ass"
            write_ass(ass_path, cues, edl["subtitles"], edl["export"]["width"], edl["export"]["height"])
        output = job_dir / "clip.mp4"
        render_clip(self.settings, self.source_url(job.payload), edl, ass_path, output)
        validation = validate_render(
            self.settings,
            output,
            edl["range"]["endMs"] - edl["range"]["startMs"],
        )
        if not validation["valid"]:
            raise JobError("RENDER_VALIDATION_FAILED", "Rendered clip failed validation", retryable=True, details=validation)
        key = self.settings.object_key(
            "derived",
            f"{job.workspace_id}/{job.project_id}/{job.clip_id}/{job.id}/clip.mp4",
        )
        artifact = self.storage.upload_file(
            output,
            self.settings.effective_derived_bucket,
            key,
            "video/mp4",
        )
        return {"artifact": artifact, "validation": validation}

    def validate(self, job: Job, job_dir: Path) -> dict:
        source_url = self.source_url(job.payload)
        local = job_dir / "validation.mp4"
        raise JobError("VALIDATION_REQUIRES_LOCAL_ARTIFACT", f"Standalone validation is not enabled for {source_url}", retryable=False)
