from __future__ import annotations

from pathlib import Path
import hashlib
import json
import math
import re
import shutil
import subprocess
import threading
import time
import zipfile
from collections.abc import Callable

from .config import Settings
from .control_api import Job
from .errors import JobError
from .media import create_browser_proxy, create_source_thumbnail, extract_audio, probe_media, validate_render, verify_timed_brand_video
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
from .subtitles import write_ass, write_srt, write_vtt
from .fonts import apply_resolved_font_plan
from .vision import SparseSourcePerception, YuNetFaceTracker


class StageRunner:
    def __init__(
        self,
        settings: Settings,
        storage: Storage,
        *,
        progress_reporter: Callable[[Job, dict], None] | None = None,
    ):
        self.settings = settings
        self.storage = storage
        self.progress_reporter = progress_reporter

    def source_url(self, payload: dict) -> str:
        source = payload.get("source") or payload.get("input")
        if not isinstance(source, dict):
            raise JobError("SOURCE_MISSING", "Job has no source", retryable=False)
        if source.get("kind") == "s3":
            return self.storage.signed_get(source["bucket"], source["key"], expires=4 * 60 * 60)
        if source.get("url") and str(source["url"]).startswith("https://"):
            return str(source["url"])
        raise JobError("SOURCE_INVALID", "Unsupported source locator", retryable=False)

    @staticmethod
    def _assert_not_cancelled(cancellation_event: threading.Event | None) -> None:
        if cancellation_event is not None and cancellation_event.is_set():
            raise JobError("JOB_CANCELLED", "Job lease was cancelled or reassigned", retryable=False)

    def _report_measured_progress(self, job: Job, progress: dict) -> None:
        """Report optional observational progress without risking paid work.

        Lease renewal is handled by the dedicated heartbeat. A temporary
        control-plane error while displaying downloaded bytes must never make
        yt-dlp abandon a source that is otherwise downloading correctly.
        """
        if self.progress_reporter is None:
            return
        try:
            self.progress_reporter(job, progress)
        except Exception:
            # The next regular lease heartbeat still decides ownership. This
            # sample is UX telemetry only, not a transactional checkpoint.
            return

    def run(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> tuple[dict, dict]:
        started = time.monotonic()
        self._assert_not_cancelled(cancellation_event)
        if job.type == "probe":
            # Keep the dispatch keyword-based: it makes the stage boundary
            # explicit and preserves lightweight probe adapters used by
            # resource verification without weakening the production method
            # signature.
            result = self.probe(job, job_dir=job_dir, cancellation_event=cancellation_event)
        elif job.type == "source_preview":
            result = self.source_preview(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "youtube_import":
            result = self.youtube_import(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "extract_audio":
            result = self.extract_audio(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "generate_proxy":
            result = self.generate_proxy(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "verify_brand_video":
            result = self.verify_brand_video(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "speech_to_text":
            result = self.speech_to_text(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "find_moments":
            result = self.find_moments(job, cancellation_event=cancellation_event)
        elif job.type == "render_clip":
            result = self.render(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "validate_render":
            result = self.validate(job, job_dir)
        elif job.type == "face_track":
            result = self.face_track(job, cancellation_event=cancellation_event)
        elif job.type in {"analyze_visual", "analyze_clip_visual"}:
            result = self.analyze_visual(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "zip_project":
            result = self.zip_project(job, job_dir, cancellation_event=cancellation_event)
        elif job.type == "cleanup":
            raise JobError("STAGE_NOT_ENABLED", "cleanup adapter is not enabled on this worker image", retryable=False)
        else:
            raise JobError("UNKNOWN_JOB_TYPE", f"Unknown job type: {job.type}", retryable=False)
        # Heavy child processes (FFmpeg, yt-dlp) do not live in the Python
        # worker's RSS.  Stages may provide their sampled process telemetry via
        # this private transport key; it is recorded on the job attempt rather
        # than exposed as part of a user-facing artifact result.
        self._assert_not_cancelled(cancellation_event)
        execution_metrics = result.pop("executionMetrics", {}) if isinstance(result, dict) else {}
        return result, {
            "wallSeconds": round(time.monotonic() - started, 3),
            **(execution_metrics if isinstance(execution_metrics, dict) else {}),
        }

    def _store_source_thumbnail(
        self,
        job: Job,
        job_dir: Path,
        input_url: str,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict | None:
        """Create the durable poster used by the source library and wizard.

        The result is deliberately an internal object descriptor, never a
        signed link. The control API owns signing it at read time, which keeps
        a source preview usable after a reload without leaking S3 credentials
        or retaining a public third-party image URL.
        """
        source_id = str(job.payload.get("sourceId") or "").strip()
        if not source_id:
            return None
        try:
            poster_path = job_dir / "source-thumbnail.jpg"
            create_source_thumbnail(
                self.settings,
                input_url,
                poster_path,
                cancellation_event=cancellation_event,
            )
            if not poster_path.is_file() or poster_path.stat().st_size <= 0:
                return None
            poster_key = self.settings.object_key(
                "derived",
                f"{job.workspace_id}/sources/{source_id}/thumbnail-v1.jpg",
            )
            return self.storage.upload_file(
                poster_path,
                self.settings.effective_derived_bucket,
                poster_key,
                "image/jpeg",
            )
        except JobError:
            # A damaged input may still be safe to process, and a thumbnail
            # must never block that workflow. The UI renders an explicit
            # unavailable state instead of an invented brand placeholder.
            return None

    def probe(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        source = job.payload["source"]
        url = self.source_url(job.payload)
        result = probe_media(self.settings, url, cancellation_event=cancellation_event)
        if source.get("kind") == "s3":
            result["fingerprint"] = self.storage.sha256_object(source["bucket"], source["key"])
            thumbnail = self._store_source_thumbnail(job, job_dir, url, cancellation_event=cancellation_event)
            if thumbnail:
                result["thumbnail"] = thumbnail
        return result

    def source_preview(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        """Read public extractor metadata without downloading media.

        This is the source-of-truth preflight used by the product wizard. It
        keeps a project out of the queue until duration, title and thumbnail
        are known, so pricing and range selection are truthful before launch.
        """
        self._assert_not_cancelled(cancellation_event)
        source = job.payload.get("source")
        # Uploaded files live in private S3. Probe them with ffprobe rather
        # than sending a browser hint through the charging path.
        if isinstance(source, dict) and source.get("kind") == "s3":
            probe = probe_media(self.settings, self.source_url(job.payload), cancellation_event=cancellation_event)
            duration_ms = int(probe.get("durationMs") or 0)
            if duration_ms <= 0:
                raise JobError("SOURCE_DURATION_UNKNOWN", "Не удалось определить длительность видео", retryable=False)
            thumbnail = self._store_source_thumbnail(
                job,
                job_dir,
                self.source_url(job.payload),
                cancellation_event=cancellation_event,
            )
            return {
                "url": None,
                "sourceId": str(job.payload.get("sourceId") or ""),
                "title": str(job.payload.get("title") or "Загруженное видео").strip()[:180] or "Загруженное видео",
                "authorName": None,
                "thumbnail": thumbnail,
                "thumbnailUrl": None,
                "durationSeconds": int(math.ceil(duration_ms / 1000)),
            }

        url = self.source_url(job.payload)
        hostname = url.split("/", 3)[2].lower() if url.startswith("https://") else ""
        allowed_hosts = {
            "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
            "vk.com", "www.vk.com", "vkvideo.ru", "www.vkvideo.ru",
            "rutube.ru", "www.rutube.ru",
            "twitch.tv", "www.twitch.tv", "clips.twitch.tv", "m.twitch.tv",
        }
        if hostname not in allowed_hosts:
            raise JobError("IMPORT_DOMAIN_DENIED", "Import is only allowed from YouTube, VK, RuTube or Twitch", retryable=False)
        try:
            completed = subprocess.run(
                [
                    self.settings.ytdlp_path,
                    "--no-playlist", "--no-warnings", "--skip-download",
                    "--dump-single-json", "--no-simulate", url,
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=45,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise JobError("SOURCE_PREVIEW_TIMEOUT", "Не удалось быстро получить данные видео", retryable=True) from error
        if completed.returncode != 0:
            raise JobError("SOURCE_PREVIEW_FAILED", "Не удалось получить данные видео — проверьте ссылку и доступ", retryable=False)
        try:
            metadata = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise JobError("SOURCE_PREVIEW_INVALID", "Источник вернул некорректные данные", retryable=False) from error
        duration = metadata.get("duration")
        duration_seconds = int(math.ceil(float(duration))) if isinstance(duration, (int, float)) and duration > 0 else 0
        if duration_seconds <= 0:
            raise JobError("SOURCE_DURATION_UNKNOWN", "Не удалось определить длительность видео", retryable=False)
        title = str(metadata.get("title") or "Видео без названия").strip()[:180]
        thumbnail = metadata.get("thumbnail")
        return {
            "url": url,
            "title": title or "Видео без названия",
            "authorName": str(metadata.get("uploader") or metadata.get("channel") or "").strip()[:180] or None,
            "thumbnailUrl": str(thumbnail) if isinstance(thumbnail, str) and thumbnail.startswith("https://") else None,
            "durationSeconds": duration_seconds,
        }

    def youtube_import(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
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
        # A single stdout stream is friendly to tiny disks, but it makes a
        # normal progressive YouTube MP4 strictly serial. On the 12 GB/100 GB
        # HVE worker that trade-off is backwards: source imports should use
        # the spare scratch capacity to get the customer to transcription as
        # quickly as possible. yt-dlp can fetch separate DASH tracks in
        # parallel and aria2c can parallelise a progressive fallback. The
        # finished file is still bounded by the same 10 GB product limit and
        # is deleted immediately after S3 confirms it.
        job_dir.mkdir(parents=True, exist_ok=True)
        output_template = str(job_dir / "source.%(ext)s")
        command = [
                self.settings.ytdlp_path,
                "--no-playlist",
                "--no-progress",
                "--no-warnings",
                "--no-part",
                "--retries", "3",
                "--fragment-retries", "3",
                "--socket-timeout", "30",
                "--concurrent-fragments", "8",
                # A lot of long YouTube sources are a single progressive
                # stream, so --concurrent-fragments alone is ineffective.
                # Keep requests below YouTube's documented 10 MiB throttle
                # boundary. yt-dlp can then re-extract a throttled URL instead
                # of letting a customer stare at an import that makes no
                # meaningful progress for many minutes.
                "--http-chunk-size", "8M",
                "--throttled-rate", "250K",
                "--merge-output-format", "mp4",
                # HVE exports at 1080×1920. Keep that ceiling, but prefer
                # independently downloadable H.264 video + AAC audio tracks.
                # This unlocks true concurrent DASH retrieval; if absent, a
                # single compatible MP4 stays an explicit fallback.
                "--format", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=1080][ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[height<=1080][ext=mp4]",
                "--output", output_template,
                url,
            ]
        downloader = getattr(self.settings, "ytdlp_external_downloader", "")
        if downloader and shutil.which(downloader):
            command[1:1] = [
                "--downloader", downloader,
                "--downloader-args", f"{downloader}:-x 8 -s 8 -k 4M --file-allocation=none",
            ]
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            shell=False,
        )
        last_reported_bytes = -1
        last_progress_report_at = 0.0
        try:
            while process.poll() is None:
                self._assert_not_cancelled(cancellation_event)
                # yt-dlp and aria2 create one or more `source.*` partial
                # files depending on whether the extractor chose DASH tracks
                # or a progressive MP4. Their total is an objective received
                # byte count even when the remote source does not disclose a
                # reliable final size. Do not fabricate a percentage.
                downloaded_bytes = sum(
                    path.stat().st_size
                    for path in job_dir.glob("source.*")
                    if path.is_file()
                )
                now = time.monotonic()
                if downloaded_bytes != last_reported_bytes and now - last_progress_report_at >= 2:
                    self._report_measured_progress(job, {
                        "completed": downloaded_bytes,
                        "unit": "bytes",
                    })
                    last_reported_bytes = downloaded_bytes
                    last_progress_report_at = now
                time.sleep(0.5)
        except JobError:
            # A reassigned lease must not leave yt-dlp/aria2 consuming the
            # worker's network and disk after the application has stopped
            # owning the job.
            process.kill()
            process.wait(timeout=5)
            raise
        stderr = process.stderr.read().decode("utf-8", errors="replace")[-2000:] if process.stderr else ""
        return_code = process.wait(timeout=5)
        if return_code != 0:
            raise JobError(
                "YOUTUBE_IMPORT_FAILED",
                "YouTube did not provide a compatible video stream",
                retryable=return_code in {1, 2},
                details={"returnCode": return_code, "stderr": stderr},
            )
        candidates = sorted(path for path in job_dir.glob("source.*") if path.is_file())
        source_path = next((path for path in candidates if path.suffix.lower() == ".mp4"), candidates[0] if candidates else None)
        if source_path is None:
            raise JobError("YOUTUBE_IMPORT_OUTPUT_MISSING", "Импорт не создал совместимый видеофайл", retryable=True)
        max_bytes = int(getattr(self.settings, "source_import_max_bytes", 10 * 1024 * 1024 * 1024))
        if source_path.stat().st_size > max_bytes:
            source_path.unlink(missing_ok=True)
            raise JobError("SOURCE_TOO_LARGE", "Видео превышает лимит 10 ГБ", retryable=False)
        try:
            self._report_measured_progress(job, {
                "completed": source_path.stat().st_size,
                "total": source_path.stat().st_size,
                "unit": "bytes",
            })
            artifact = self.storage.upload_file(
                source_path,
                self.settings.effective_raw_bucket,
                key,
                "video/mp4",
            )
            source_url = self.storage.signed_get(artifact["bucket"], artifact["key"], expires=3600)
            probe = probe_media(self.settings, source_url, cancellation_event=cancellation_event)
            thumbnail = self._store_source_thumbnail(job, job_dir, source_url, cancellation_event=cancellation_event)
            return {
                **artifact,
                **probe,
                "fingerprint": artifact["sha256"],
                **({"thumbnail": thumbnail} if thumbnail else {}),
            }
        finally:
            source_path.unlink(missing_ok=True)

    def extract_audio(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        output = job_dir / "audio.mp3"
        source_range = job.payload.get("sourceRange")
        start_ms = 0
        end_ms = None
        if isinstance(source_range, dict):
            start_ms = int(source_range.get("startMs") or 0)
            raw_end = source_range.get("endMs")
            end_ms = int(raw_end) if raw_end is not None else None
        extract_audio(
            self.settings,
            self.source_url(job.payload),
            output,
            start_ms=start_ms,
            end_ms=end_ms,
            cancellation_event=cancellation_event,
        )
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
        return {"audio": artifact, "sourceOffsetMs": start_ms}

    def generate_proxy(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        source = job.payload.get("source")
        source_id = str(job.payload.get("sourceId", ""))
        source_hash = str(job.payload.get("sourceHash", "")).lower()
        if not isinstance(source, dict) or not source_id or not re.fullmatch(r"[a-f0-9]{64}", source_hash):
            raise JobError("PROXY_PAYLOAD_INVALID", "Browser proxy identifiers are missing", retryable=False)
        output = job_dir / "browser-proxy.mp4"
        execution_metrics = create_browser_proxy(
            self.settings,
            self.source_url(job.payload),
            output,
            cancellation_event=cancellation_event,
        )
        probe = probe_media(self.settings, str(output), cancellation_event=cancellation_event)
        video = probe.get("video") or {}
        if video.get("codec_name") != "h264" or (probe.get("audio") and probe["audio"].get("codec_name") != "aac"):
            raise JobError("PROXY_PROFILE_INVALID", "Browser proxy does not have the required H.264/AAC profile", retryable=True)
        key = self.settings.object_key("proxy", f"{job.workspace_id}/sources/{source_id}/{source_hash}/browser-720p-v1.mp4")
        artifact = self.storage.upload_file(output, self.settings.effective_proxy_bucket, key, "video/mp4")
        return {
            "sourceId": source_id,
            "sourceHash": source_hash,
            "profile": "browser-720p-v1",
            "artifact": artifact,
            "probe": probe,
            "executionMetrics": execution_metrics,
        }

    def verify_brand_video(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        """Turn an upload claim into a bounded, render-safe timed asset.

        This happens before an asset can enter a ClipDocumentV2. The worker
        downloads by the API-owned bucket/key pair, checks the exact expected
        bytes, fully decodes it, and only reports facts back to the control
        plane. It never trusts a browser MIME label or a user URL.
        """
        asset_id = str(job.payload.get("assetId", ""))
        media_object_id = str(job.payload.get("mediaObjectId", ""))
        source = job.payload.get("source")
        declared_size = job.payload.get("declaredByteSize")
        if (
            not re.fullmatch(r"[0-9a-f-]{36}", asset_id)
            or not re.fullmatch(r"[0-9a-f-]{36}", media_object_id)
            or not isinstance(source, dict)
            or source.get("kind") != "s3"
            or not isinstance(source.get("bucket"), str)
            or not isinstance(source.get("key"), str)
            or not isinstance(declared_size, int)
            or declared_size <= 0
            or declared_size > 100 * 1024 * 1024
        ):
            raise JobError("HVE_TIMED_ASSET_PAYLOAD_INVALID", "Timed media verification payload is invalid", retryable=False)
        local = job_dir / "brand-video.mp4"
        try:
            self.storage.download_bounded_file(
                source["bucket"], source["key"], local,
                expected_bytes=declared_size,
                max_bytes=100 * 1024 * 1024,
            )
            verification = verify_timed_brand_video(self.settings, local, cancellation_event=cancellation_event)
        except ValueError as error:
            raise JobError("HVE_TIMED_ASSET_INVALID", str(error), retryable=False) from error
        except JobError:
            raise
        # Assets may reach 100 MiB. Hash the verified file incrementally so a
        # cheap verification job never turns into a 100 MiB RAM spike.
        digest = hashlib.sha256()
        with local.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        sha256 = digest.hexdigest()
        return {
            "assetId": asset_id,
            "mediaObjectId": media_object_id,
            "sha256": sha256,
            "byteSize": local.stat().st_size,
            "mimeType": "video/mp4",
            "verification": verification,
        }

    def speech_to_text(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        self._assert_not_cancelled(cancellation_event)
        audio = job.payload["audio"]
        url = self.storage.signed_get(audio["bucket"], audio["key"], expires=4 * 60 * 60)
        provider = FasterWhisperStt(self.settings)
        result = provider.transcribe(
            url,
            job.payload.get("language", "auto"),
            job_dir,
            cancellation_event=cancellation_event,
        )
        source_offset_ms = int(job.payload.get("sourceOffsetMs") or 0)
        if source_offset_ms:
            result["response"] = self._shift_transcript_to_source_time(result["response"], source_offset_ms)
        return {"provider": provider.name, **result}

    @staticmethod
    def _shift_transcript_to_source_time(response: dict, offset_ms: int) -> dict:
        """Convert a trimmed-audio transcript back to absolute source time.

        Faster-Whisper necessarily starts at zero for the extracted audio.
        HVE candidates, trims and rendering use source time, so keeping that
        offset private would create clips from the wrong part of the original.
        """
        output = dict(response)
        offset_seconds = offset_ms / 1000
        for segment in output.get("segments", []):
            if isinstance(segment, dict):
                for key in ("start", "end"):
                    if isinstance(segment.get(key), (int, float)):
                        segment[key] = float(segment[key]) + offset_seconds
        for word in output.get("words", []):
            if isinstance(word, dict):
                for key in ("start", "end"):
                    if isinstance(word.get(key), (int, float)):
                        word[key] = float(word[key]) + offset_seconds
                for key in ("startMs", "endMs"):
                    if isinstance(word.get(key), (int, float)):
                        word[key] = int(word[key]) + offset_ms
        for interval in output.get("speechIntervals", []):
            if isinstance(interval, dict):
                for key in ("startMs", "endMs"):
                    if isinstance(interval.get(key), (int, float)):
                        interval[key] = int(interval[key]) + offset_ms
        output["sourceOffsetMs"] = offset_ms
        return output

    def find_moments(
        self,
        job: Job,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        self._assert_not_cancelled(cancellation_event)
        transcript = job.payload["transcript"]
        settings = job.payload["settings"]
        segments = compact_transcript(transcript)
        deterministic = deterministic_candidates(segments, settings)
        if deterministic is not None:
            self._assert_not_cancelled(cancellation_event)
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
            self._assert_not_cancelled(cancellation_event)
            prompt = (
                f"Настройки: {settings_json(settings)}\n\n"
                f"Транскрипт с таймкодами в миллисекундах:\n{transcript_text(chunk)}"
            )
            response = provider.complete_json(candidate_model, system, prompt, cancellation_event=cancellation_event)
            if isinstance(response.get("candidates"), list):
                candidates.extend(response["candidates"])
        if not candidates:
            raise JobError("MOMENTS_NOT_FOUND", "The model returned no usable moment candidates", retryable=True)
        rerank_prompt = (
            f"Настройки: {settings_json(settings)}\n"
            "Удалите дубли, сохраните сильнейшие фрагменты и разнообразие тем. "
            f"Кандидаты: {json.dumps(candidates[:200], ensure_ascii=False, separators=(',', ':'))}"
        )
        self._assert_not_cancelled(cancellation_event)
        ranked = provider.complete_json(rerank_model, system, rerank_prompt, cancellation_event=cancellation_event)
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

    def face_track(
        self,
        job: Job,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        self._assert_not_cancelled(cancellation_event)
        if not isinstance(job.payload.get("source"), dict):
            # Backwards-compatible completion for jobs enqueued by an older
            # control API before source/range were included in face tracking.
            return {
                "cropTrack": [],
                "faceTracks": [],
                "faceCount": 0,
                "fallback": "static_crop",
                "warnings": ["FACE_JOB_PAYLOAD_LEGACY"],
            }
        range_value = job.payload.get("range") or {}
        export = job.payload.get("export") or {}
        tracker = YuNetFaceTracker(self.settings)
        return tracker.analyze(
            self.source_url(job.payload),
            int(range_value.get("startMs", 0)),
            int(range_value.get("endMs", 0)),
            int(export.get("width", 1080)),
            int(export.get("height", 1920)),
            cancellation_event=cancellation_event,
        )

    def analyze_visual(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        """Persist an HVE-5 fact graph, never decoded images or embeddings.

        ``analyze_clip_visual`` is intentionally just a bounded variant of
        this stage.  It receives an explicit source range from a later editor
        action; it must never turn a sparse source job into an unbounded dense
        pass on its own.
        """
        self._assert_not_cancelled(cancellation_event)
        source = job.payload.get("source")
        if not isinstance(source, dict):
            raise JobError("VISION_SOURCE_MISSING", "Visual analysis job has no source", retryable=False)
        source_id = str(job.payload.get("sourceId", ""))
        source_hash = str(job.payload.get("sourceHash", ""))
        analysis_id = str(job.payload.get("analysisId", ""))
        if not source_id or not source_hash or not analysis_id:
            raise JobError("VISION_ANALYSIS_PAYLOAD_INVALID", "Visual analysis identifiers are missing", retryable=False)
        is_clip_scope = job.type == "analyze_clip_visual"
        range_value = job.payload.get("range") if is_clip_scope else None
        if is_clip_scope and not isinstance(range_value, dict):
            raise JobError("VISION_CLIP_RANGE_MISSING", "Dense clip analysis requires a source range", retryable=False)
        graph = SparseSourcePerception(self.settings).analyze(
            self.source_url(job.payload),
            source_id=source_id,
            source_hash=source_hash,
            duration_ms_hint=int(job.payload.get("durationMs", 0) or 0),
            range_start_ms=int(range_value.get("startMs", 0)) if isinstance(range_value, dict) else 0,
            range_end_ms=int(range_value["endMs"]) if isinstance(range_value, dict) and range_value.get("endMs") is not None else None,
            sample_fps=self.settings.vision_clip_sample_fps if is_clip_scope else self.settings.vision_source_sample_fps,
            maximum_samples=self.settings.vision_clip_max_samples if is_clip_scope else self.settings.vision_source_max_samples,
            cancellation_event=cancellation_event,
        )
        summary = graph.pop("_summary", {})
        density = str(summary.get("density", "sparse"))
        if density not in {"sparse", "dense"}:
            raise JobError("VISION_DENSITY_INVALID", "Visual analysis returned an invalid density", retryable=False)
        coverage = summary.get("coverage")
        if not isinstance(coverage, list) or not coverage:
            raise JobError("VISION_COVERAGE_INVALID", "Visual analysis returned no coverage", retryable=False)
        path = job_dir / "scene-graph-v1.json"
        serialized = json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        # A cancelled lease must not publish an analysis artifact after the
        # expensive decode has completed. The worker can leave job-local
        # scratch for the normal orphan cleanup, but the control plane must
        # never observe this stale graph as a completed result.
        self._assert_not_cancelled(cancellation_event)
        path.write_text(serialized, encoding="utf-8")
        sha256 = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        key = self.settings.object_key(
            "derived",
            f"{job.workspace_id}/sources/{source_id}/analyses/{analysis_id}/scene-graph-v1.json",
        )
        self._assert_not_cancelled(cancellation_event)
        artifact = self.storage.upload_file(
            path,
            self.settings.effective_derived_bucket,
            key,
            "application/vnd.4short.hve-scene-graph+json",
        )
        artifact["sha256"] = sha256
        return {
            "analysisId": analysis_id,
            "sourceId": source_id,
            "sourceHash": source_hash.lower(),
            # The control API resolves this exact triple to an immutable
            # engine_release row.  A source fact graph must never be recorded
            # as if it had been created by an arbitrary current worker.
            "engineRelease": {
                "engineVersion": self.settings.hve_engine_version,
                "plannerVersion": self.settings.hve_planner_version,
                "rendererVersion": self.settings.hve_renderer_version,
            },
            "artifact": artifact,
            "durationUs": graph["durationUs"],
            "media": job.payload.get("media", {}),
            "warnings": graph["warnings"],
            "coverage": coverage,
            "density": density,
            "summary": summary,
        }

    def render(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        edl = job.payload["edl"]
        ass_path = None
        cues = job.payload.get("subtitleCues", [])
        resolved_plan = job.payload.get("resolvedPlan")
        font_plan = resolved_plan.get("fontPlan") if isinstance(resolved_plan, dict) else None
        subtitle_config = apply_resolved_font_plan(edl["subtitles"], font_plan)
        resolved_layers = resolved_plan.get("layerPlan") if isinstance(resolved_plan, dict) and isinstance(resolved_plan.get("layerPlan"), list) else []
        production_text_layers = [layer for layer in resolved_layers if isinstance(layer, dict) and layer.get("type") == "text"]
        production_static_layers = [layer for layer in resolved_layers if isinstance(layer, dict) and layer.get("type") in {"image", "logo", "banner"}]
        production_timed_video_layers = [layer for layer in resolved_layers if isinstance(layer, dict) and layer.get("type") in {"video", "broll"}]
        static_image_layers = self._download_static_render_assets(job, job_dir, production_static_layers)
        timed_video_layers = self._download_timed_video_render_assets(job, job_dir, production_timed_video_layers)
        # A V1 title imported into V2 becomes a resolved layer. Render one
        # source of truth, never both the legacy EDL title and the V2 layer.
        title = None if production_text_layers else edl.get("title")
        if (subtitle_config.get("enabled") and cues) or (title and title.get("text")) or production_text_layers:
            ass_path = job_dir / "subtitles.ass"
            write_ass(
                ass_path,
                cues if subtitle_config.get("enabled") else [],
                subtitle_config,
                edl["export"]["width"],
                edl["export"]["height"],
                title,
                production_text_layers,
            )
        output = job_dir / "clip.mp4"
        render_metrics: dict[str, int | float] = {}
        hve2_time_map = resolved_plan.get("timeMap") if isinstance(resolved_plan, dict) and isinstance(resolved_plan.get("timeMap"), list) else None
        audio_policy = resolved_plan.get("audioPlan") if isinstance(resolved_plan, dict) and isinstance(resolved_plan.get("audioPlan"), dict) else None
        resolved_layout_segments = resolved_plan.get("layoutSegments") if isinstance(resolved_plan, dict) and isinstance(resolved_plan.get("layoutSegments"), list) and resolved_plan.get("layoutSegments") else None
        expected_duration_ms = render_clip(
            self.settings,
            self.source_url(job.payload),
            edl,
            ass_path,
            output,
            has_audio=bool(job.payload.get("sourceHasAudio", True)),
            process_metrics=render_metrics,
            hve2_time_map=hve2_time_map,
            audio_policy=audio_policy,
            resolved_layout_segments=resolved_layout_segments,
            static_image_layers=static_image_layers,
            timed_video_layers=timed_video_layers,
            cancellation_event=cancellation_event,
        )
        validation = validate_render(
            self.settings,
            output,
            expected_duration_ms,
            edl["export"],
            expect_audio=bool(job.payload.get("sourceHasAudio", True)),
            cancellation_event=cancellation_event,
        )
        if not validation["valid"]:
            raise JobError("RENDER_VALIDATION_FAILED", "Rendered clip failed validation", retryable=True, details=validation)
        # Do not publish a render from a lease that was lost while FFmpeg was
        # validating the output. A cancellation racing *inside* a multipart
        # upload can still leave an unattached object for lifecycle cleanup,
        # but no stale render is intentionally started after this point.
        self._assert_not_cancelled(cancellation_event)
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
        # Captions are generated from the exact resolved output clock that
        # drove ASS. They are artifacts of this render version, not a new STT
        # request and not a browser-side reconstruction. Keep them separate
        # from the MP4 so a later ZIP is a pure packaging operation.
        caption_artifacts: dict[str, dict] = {}
        if cues:
            srt_path = job_dir / "captions.srt"
            vtt_path = job_dir / "captions.vtt"
            write_srt(srt_path, cues)
            write_vtt(vtt_path, cues)
            for kind, path, content_type in (
                ("srt", srt_path, "application/x-subrip"),
                ("vtt", vtt_path, "text/vtt; charset=utf-8"),
            ):
                self._assert_not_cancelled(cancellation_event)
                caption_artifacts[kind] = self.storage.upload_file(
                    path,
                    self.settings.effective_derived_bucket,
                    self.settings.object_key(
                        "derived",
                        f"{job.workspace_id}/{job.project_id}/{job.clip_id}/{job.id}/captions.{kind}",
                    ),
                    content_type,
                )
        return {
            "artifact": artifact,
            "captionArtifacts": caption_artifacts,
            "validation": validation,
            "executionMetrics": render_metrics,
        }

    @staticmethod
    def _package_member_name(number: int, title: object, kind: str) -> str:
        """Return a zip-only, traversal-safe deterministic member name."""
        raw_title = str(title or "clip").strip()
        slug = re.sub(r"[^\w.-]+", "-", raw_title, flags=re.UNICODE).strip(".-_")[:80]
        # A filename component cannot traverse on its own, but remove dot-dot
        # runs anyway so archive viewers never display a suspicious path.
        while ".." in slug:
            slug = slug.replace("..", "-")
        slug = re.sub(r"-{2,}", "-", slug).strip(".-_")
        slug = slug or "clip"
        extension = {"mp4": "mp4", "srt": "srt", "vtt": "vtt"}[kind]
        return f"clips/{number:03d}-{slug}/{kind}.{extension}"

    def zip_project(
        self,
        job: Job,
        job_dir: Path,
        *,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        """Build a bounded immutable project package from a DB snapshot.

        The worker never discovers clips by object listing and never accepts a
        URL here. The control API supplies a version-pinned artifact manifest;
        the worker validates every field before touching S3 or the zip writer.
        """
        job_dir.mkdir(parents=True, exist_ok=True)
        package_id = str(job.payload.get("packageId", ""))
        manifest_hash = str(job.payload.get("manifestHash", ""))
        items = job.payload.get("items")
        if (
            not re.fullmatch(r"[0-9a-fA-F-]{36}", package_id)
            or not re.fullmatch(r"[0-9a-f]{64}", manifest_hash)
            or not isinstance(items, list)
            or not items
            or len(items) > self.settings.package_max_artifacts
        ):
            raise JobError("HVE_PACKAGE_MANIFEST_INVALID", "Project package manifest is invalid", retryable=False)

        allowed_kinds = {"mp4", "srt", "vtt"}
        total_input_bytes = 0
        artifact_count = 0
        normalized_items: list[tuple[int, str, list[dict]]] = []
        seen_clips: set[str] = set()
        for index, raw_item in enumerate(items, start=1):
            if not isinstance(raw_item, dict):
                raise JobError("HVE_PACKAGE_MANIFEST_INVALID", "Package item is invalid", retryable=False)
            clip_id = str(raw_item.get("clipId", ""))
            artifacts = raw_item.get("artifacts")
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", clip_id) or clip_id in seen_clips or not isinstance(artifacts, list):
                raise JobError("HVE_PACKAGE_MANIFEST_INVALID", "Package item is invalid", retryable=False)
            seen_clips.add(clip_id)
            by_kind: dict[str, dict] = {}
            for artifact in artifacts:
                if not isinstance(artifact, dict):
                    raise JobError("HVE_PACKAGE_MANIFEST_INVALID", "Package artifact is invalid", retryable=False)
                kind = str(artifact.get("kind", ""))
                bucket = artifact.get("bucket")
                key = artifact.get("key")
                byte_size = artifact.get("byteSize")
                sha256 = artifact.get("sha256")
                if (
                    kind not in allowed_kinds or kind in by_kind
                    or not isinstance(bucket, str) or not bucket
                    or not isinstance(key, str) or not key or key.startswith("/") or ".." in key.split("/")
                    or not isinstance(byte_size, int) or byte_size < 0
                    or (sha256 is not None and (not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256)))
                ):
                    raise JobError("HVE_PACKAGE_MANIFEST_INVALID", "Package artifact is invalid", retryable=False)
                total_input_bytes += byte_size
                artifact_count += 1
                by_kind[kind] = {
                    "kind": kind,
                    "bucket": bucket,
                    "key": key,
                    "byteSize": byte_size,
                    # Legacy artifacts created before content hashes remain
                    # downloadable, but all newly rendered artifacts include
                    # this integrity binding.
                    **({"sha256": sha256} if isinstance(sha256, str) else {}),
                }
            if "mp4" not in by_kind:
                raise JobError("HVE_PACKAGE_VIDEO_REQUIRED", "Each package clip requires an MP4 artifact", retryable=False)
            normalized_items.append((index, str(raw_item.get("title", "clip")), [by_kind[key] for key in ("mp4", "srt", "vtt") if key in by_kind]))

        if artifact_count > self.settings.package_max_artifacts or total_input_bytes > self.settings.package_max_bytes:
            raise JobError(
                "HVE_PACKAGE_TOO_LARGE",
                "Project package exceeds the safe worker limit",
                retryable=False,
                details={"artifactCount": artifact_count, "inputBytes": total_input_bytes},
            )

        # Packaging temporarily needs both the downloaded members and the
        # archive.  Admission by a generic `io` slot is not sufficient here:
        # a perfectly valid eight-gigabyte manifest could otherwise fill the
        # worker's scratch disk halfway through the job. Keep a small fixed
        # margin for Zip64 metadata and the worker's own logs.
        required_scratch = total_input_bytes * 2 + 32 * 1024 * 1024
        available_scratch = shutil.disk_usage(job_dir).free
        if available_scratch < required_scratch:
            raise JobError(
                "HVE_PACKAGE_SCRATCH_INSUFFICIENT",
                "Not enough temporary disk space to safely build this package",
                retryable=True,
                details={"requiredBytes": required_scratch, "availableBytes": available_scratch},
            )

        archive_path = job_dir / "project-clips.zip"
        downloaded_path = job_dir / "package-input"
        written = 0
        try:
            with zipfile.ZipFile(archive_path, "w", allowZip64=True) as archive:
                for number, title, artifacts in normalized_items:
                    for artifact in artifacts:
                        self._assert_not_cancelled(cancellation_event)
                        member_name = self._package_member_name(number, title, artifact["kind"])
                        local_path = downloaded_path / member_name
                        try:
                            downloaded = self.storage.download_bounded_file(
                                artifact["bucket"],
                                artifact["key"],
                                local_path,
                                expected_bytes=artifact["byteSize"],
                                expected_sha256=artifact.get("sha256"),
                                max_bytes=min(self.settings.package_max_bytes, artifact["byteSize"]),
                            )
                        except ValueError as error:
                            raise JobError("HVE_PACKAGE_ARTIFACT_INVALID", str(error), retryable=True) from error
                        compress_type = zipfile.ZIP_STORED if artifact["kind"] == "mp4" else zipfile.ZIP_DEFLATED
                        info = zipfile.ZipInfo(member_name, date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = compress_type
                        info.external_attr = 0o600 << 16
                        with local_path.open("rb") as source, archive.open(info, "w", force_zip64=True) as destination:
                            shutil.copyfileobj(source, destination, length=1024 * 1024)
                        local_path.unlink(missing_ok=True)
                        written += downloaded
                        self._assert_not_cancelled(cancellation_event)
            if not archive_path.is_file() or archive_path.stat().st_size > self.settings.package_max_bytes + 1024 * 1024:
                raise JobError("HVE_PACKAGE_TOO_LARGE", "Project package exceeds the safe output limit", retryable=False)
            # Re-open the finished archive before publishing it. `testzip()`
            # verifies each member's CRC and catches a partial/corrupt local
            # archive before it becomes a user-visible S3 artifact.
            with zipfile.ZipFile(archive_path, "r") as verification_archive:
                failed_member = verification_archive.testzip()
                if failed_member is not None:
                    raise JobError(
                        "HVE_PACKAGE_ARCHIVE_INVALID",
                        "Project package failed local integrity verification",
                        retryable=True,
                        details={"member": failed_member},
                    )
            artifact = self.storage.upload_file(
                archive_path,
                self.settings.effective_derived_bucket,
                self.settings.object_key("derived", f"{job.workspace_id}/{job.project_id}/packages/{package_id}/clips.zip"),
                "application/zip",
            )
        except zipfile.BadZipFile as error:
            raise JobError("HVE_PACKAGE_ARCHIVE_FAILED", "Could not create project archive", retryable=True) from error
        return {
            "packageId": package_id,
            "manifestHash": manifest_hash,
            "artifact": artifact,
            "itemCount": len(normalized_items),
            "artifactCount": artifact_count,
            "inputBytes": written,
        }

    def _download_static_render_assets(self, job: Job, job_dir: Path, layers: list[dict]) -> list[dict]:
        """Resolve only control-plane approved static assets into job scratch.

        The resolved plan contains an asset hash but not a storage location.
        `renderAssets` is the private control-plane snapshot of that location.
        Both sides have to match exactly before an input is offered to FFmpeg.
        """
        if not layers:
            return []
        asset_rows = job.payload.get("renderAssets")
        if not isinstance(asset_rows, list):
            raise JobError("HVE_STATIC_ASSETS_MISSING", "Static asset locations are missing from the render job", retryable=False)
        by_id: dict[str, dict] = {}
        for candidate in asset_rows:
            if not isinstance(candidate, dict):
                raise JobError("HVE_STATIC_ASSET_INVALID", "Static asset payload is invalid", retryable=False)
            asset_id = candidate.get("assetId")
            if not isinstance(asset_id, str) or asset_id in by_id:
                raise JobError("HVE_STATIC_ASSET_INVALID", "Static asset identifiers are invalid", retryable=False)
            by_id[asset_id] = candidate
        extensions = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
        materialized: list[dict] = []
        for layer in layers:
            asset = layer.get("asset")
            if not isinstance(asset, dict):
                raise JobError("HVE_STATIC_ASSET_INVALID", "Resolved static asset is invalid", retryable=False)
            asset_id = asset.get("assetId")
            sha256 = asset.get("sha256")
            mime_type = asset.get("mimeType")
            byte_size = asset.get("byteSize")
            row = by_id.get(asset_id) if isinstance(asset_id, str) else None
            if (
                not row
                or not isinstance(sha256, str)
                or not isinstance(mime_type, str)
                or not isinstance(byte_size, int)
                or row.get("sha256") != sha256
                or row.get("mimeType") != mime_type
                or row.get("byteSize") != byte_size
                or not isinstance(row.get("bucket"), str)
                or not isinstance(row.get("key"), str)
                or mime_type not in extensions
                or byte_size <= 0
                or byte_size > 25 * 1024 * 1024
            ):
                raise JobError("HVE_STATIC_ASSET_INVALID", "Static asset does not match its resolved render plan", retryable=False)
            local = job_dir / "assets" / f"{asset_id}{extensions[mime_type]}"
            try:
                downloaded_bytes = self.storage.download_verified_file(
                    row["bucket"],
                    row["key"],
                    local,
                    expected_sha256=sha256,
                    max_bytes=25 * 1024 * 1024,
                )
            except ValueError as error:
                raise JobError(str(error), "Static brand asset could not be verified", retryable=False) from error
            if downloaded_bytes != byte_size:
                local.unlink(missing_ok=True)
                raise JobError("HVE_STATIC_ASSET_SIZE_MISMATCH", "Static brand asset size changed after planning", retryable=False)
            materialized.append({**layer, "path": str(local)})
        return materialized

    def _download_timed_video_render_assets(self, job: Job, job_dir: Path, layers: list[dict]) -> list[dict]:
        """Materialize only immutable, worker-verified timed visual overlays.

        The worker receives a private locator snapshot separately from the
        canonical plan, then verifies its SHA and bounded size again. This is
        A `video` layer is a muted visual overlay. A B-roll layer shares the
        immutable verification path but has its own full-canvas / no-loop
        policy, enforced both by the planner and again here. Outro remains a
        distinct end-of-timeline primitive and is deliberately unsupported.
        """
        if not layers:
            return []
        asset_rows = job.payload.get("renderAssets")
        if not isinstance(asset_rows, list):
            raise JobError("HVE_TIMED_VIDEO_ASSETS_MISSING", "Timed video asset locations are missing from the render job", retryable=False)
        by_id: dict[str, dict] = {}
        for candidate in asset_rows:
            if not isinstance(candidate, dict):
                raise JobError("HVE_TIMED_VIDEO_ASSET_INVALID", "Timed video asset payload is invalid", retryable=False)
            asset_id = candidate.get("assetId")
            if not isinstance(asset_id, str) or asset_id in by_id:
                raise JobError("HVE_TIMED_VIDEO_ASSET_INVALID", "Timed video asset identifiers are invalid", retryable=False)
            by_id[asset_id] = candidate
        materialized: list[dict] = []
        for layer in layers:
            asset = layer.get("asset")
            if not isinstance(asset, dict):
                raise JobError("HVE_TIMED_VIDEO_ASSET_INVALID", "Resolved timed video asset is invalid", retryable=False)
            asset_id = asset.get("assetId")
            sha256 = asset.get("sha256")
            mime_type = asset.get("mimeType")
            byte_size = asset.get("byteSize")
            duration_ms = asset.get("durationMs")
            profile = asset.get("profile")
            audio_policy = asset.get("audioPolicy")
            row = by_id.get(asset_id) if isinstance(asset_id, str) else None
            layer_type = layer.get("type") if isinstance(layer, dict) else None
            is_overlay = layer_type == "video"
            is_broll = layer_type == "broll"
            if (
                not row
                or not isinstance(sha256, str)
                or not isinstance(byte_size, int)
                or not isinstance(duration_ms, int)
                or mime_type != "video/mp4"
                or profile != "hve-timed-visual-h264-aac-v1"
                or audio_policy != "muted_until_timed_audio_is_implemented"
                or row.get("sha256") != sha256
                or row.get("kind") != layer_type
                or row.get("mimeType") != mime_type
                or row.get("byteSize") != byte_size
                or not isinstance(row.get("bucket"), str)
                or not isinstance(row.get("key"), str)
                or byte_size <= 0
                or byte_size > 100 * 1024 * 1024
                or duration_ms < 40
                or duration_ms > 120_000
                or (is_overlay and not isinstance(layer.get("loop"), bool))
                or (not is_overlay and not is_broll)
            ):
                raise JobError("HVE_TIMED_VIDEO_ASSET_INVALID", "Timed video asset does not match its resolved render plan", retryable=False)
            if is_broll:
                destination = layer.get("destinationPx")
                output_range = layer.get("outputRange")
                if (
                    asset.get("kind") != "broll"
                    or layer.get("muted") is not True
                    or layer.get("visualPolicy") != "replace_full_canvas_keep_narrative_audio"
                    or layer.get("fit") != "cover"
                    or layer.get("opacity") != 1
                    or int(layer.get("zIndex", -1)) < 0
                    or int(layer.get("zIndex", -1)) > 5
                    or not isinstance(destination, dict)
                    or not isinstance(output_range, dict)
                    or int(destination.get("x", -1)) != 0
                    or int(destination.get("y", -1)) != 0
                    or int(destination.get("width", 0)) <= 0
                    or int(destination.get("height", 0)) <= 0
                    or int(output_range.get("endUs", -1)) <= int(output_range.get("startUs", -1))
                    or duration_ms < math.ceil((int(output_range.get("endUs", 0)) - int(output_range.get("startUs", 0))) / 1_000)
                ):
                    raise JobError("HVE_BROLL_RENDER_POLICY_INVALID", "B-roll does not meet the verified full-canvas visual policy", retryable=False)
            local = job_dir / "assets" / f"{asset_id}.mp4"
            try:
                downloaded_bytes = self.storage.download_verified_file(
                    row["bucket"],
                    row["key"],
                    local,
                    expected_sha256=sha256,
                    max_bytes=100 * 1024 * 1024,
                )
            except ValueError as error:
                raise JobError(str(error), "Timed video asset could not be verified", retryable=False) from error
            if downloaded_bytes != byte_size:
                local.unlink(missing_ok=True)
                raise JobError("HVE_TIMED_VIDEO_ASSET_SIZE_MISMATCH", "Timed video asset size changed after planning", retryable=False)
            verification = verify_timed_brand_video(self.settings, local)
            if (
                verification.get("profile") != profile
                or verification.get("durationMs") != duration_ms
                or verification.get("audioPolicy") != audio_policy
            ):
                local.unlink(missing_ok=True)
                raise JobError("HVE_TIMED_VIDEO_ASSET_REVALIDATION_FAILED", "Timed video asset no longer matches its verified profile", retryable=False)
            materialized.append({**layer, "path": str(local)})
        return materialized

    def validate(self, job: Job, job_dir: Path) -> dict:
        source_url = self.source_url(job.payload)
        local = job_dir / "validation.mp4"
        raise JobError("VALIDATION_REQUIRES_LOCAL_ARTIFACT", f"Standalone validation is not enabled for {source_url}", retryable=False)
