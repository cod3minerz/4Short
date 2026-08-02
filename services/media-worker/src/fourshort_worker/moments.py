from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Iterable

from .errors import JobError


@dataclass(frozen=True)
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str


def compact_transcript(payload: object) -> list[TranscriptSegment]:
    if not isinstance(payload, dict) or not isinstance(payload.get("segments"), list):
        raise JobError("TRANSCRIPT_INVALID", "Transcript has no timed segments", retryable=False)
    result: list[TranscriptSegment] = []
    for raw in payload["segments"]:
        if not isinstance(raw, dict):
            continue
        try:
            start_ms = round(float(raw["start"]) * 1000)
            end_ms = round(float(raw["end"]) * 1000)
        except (KeyError, TypeError, ValueError):
            continue
        text = str(raw.get("text", "")).strip()
        if start_ms < 0 or end_ms <= start_ms or not text:
            continue
        result.append(TranscriptSegment(start_ms, end_ms, text))
    if not result:
        raise JobError("TRANSCRIPT_EMPTY", "Transcript contains no usable speech", retryable=False)
    return result


def chunk_transcript(
    segments: list[TranscriptSegment],
    max_characters: int = 32_000,
    overlap_segments: int = 4,
) -> list[list[TranscriptSegment]]:
    chunks: list[list[TranscriptSegment]] = []
    cursor = 0
    while cursor < len(segments):
        chunk: list[TranscriptSegment] = []
        size = 0
        index = cursor
        while index < len(segments):
            line_size = len(segments[index].text) + 32
            if chunk and size + line_size > max_characters:
                break
            chunk.append(segments[index])
            size += line_size
            index += 1
        chunks.append(chunk)
        if index >= len(segments):
            break
        cursor = max(cursor + 1, index - overlap_segments)
    return chunks


def transcript_text(segments: Iterable[TranscriptSegment]) -> str:
    return "\n".join(f"[{item.start_ms}-{item.end_ms}] {item.text}" for item in segments)


def _settings(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    nested = value.get("momentSettings")
    return nested if isinstance(nested, dict) else value


def deterministic_candidates(segments: list[TranscriptSegment], settings: object) -> list[dict] | None:
    config = _settings(settings)
    mode = config.get("mode")
    if mode not in {"uniform", "manual"}:
        return None
    source_range = config.get("sourceRange") if isinstance(config.get("sourceRange"), dict) else {}
    source_start = max(segments[0].start_ms, int(source_range.get("startSeconds", 0) or 0) * 1000)
    source_end = min(
        segments[-1].end_ms,
        int(source_range.get("endSeconds", 0) or 0) * 1000 or segments[-1].end_ms,
    )
    if source_end <= source_start:
        raise JobError("SOURCE_RANGE_INVALID", "Selected source range contains no speech", retryable=False)
    if mode == "manual":
        return [{
            "startMs": source_start,
            "endMs": source_end,
            "title": "Выбранный фрагмент",
            "topic": "Ручной выбор",
            "explanation": "Диапазон выбран пользователем",
            "score": None,
            "warnings": [],
        }]

    minimum = int(config.get("durationMinSeconds", 30) or 30) * 1000
    maximum = int(config.get("durationMaxSeconds", 60) or 60) * 1000
    target = max(minimum, (minimum + maximum) // 2)
    requested = config.get("count")
    count = int(requested) if isinstance(requested, int) else max(1, (source_end - source_start) // target)
    count = max(1, min(count, 50))
    step = max(1, (source_end - source_start) // count)
    output = []
    for index in range(count):
        start = source_start + index * step
        end = source_end if index == count - 1 else min(source_end, start + min(maximum, step))
        if end - start < minimum and output:
            output[-1]["endMs"] = source_end
            break
        output.append({
            "startMs": start,
            "endMs": end,
            "title": f"Фрагмент {index + 1}",
            "topic": "Равномерная нарезка",
            "explanation": "Фрагмент распределён равномерно по выбранному диапазону",
            "score": None,
            "warnings": [],
        })
    return output


def normalize_candidates(raw_candidates: object, segments: list[TranscriptSegment], settings: object) -> list[dict]:
    if not isinstance(raw_candidates, list):
        return []
    config = _settings(settings)
    source_start = segments[0].start_ms
    source_end = segments[-1].end_ms
    minimum = int(config.get("durationMinSeconds", 10) or 10) * 1000
    maximum = int(config.get("durationMaxSeconds", 90) or 90) * 1000
    if config.get("allowThoughtCompletion", True):
        maximum += 15_000
    normalized: list[dict] = []
    for raw in raw_candidates:
        if not isinstance(raw, dict):
            continue
        try:
            start = max(source_start, int(float(raw["startMs"])))
            end = min(source_end, int(float(raw["endMs"])))
        except (KeyError, TypeError, ValueError):
            continue
        duration = end - start
        if duration < minimum or duration > maximum:
            continue
        if any(min(end, item["endMs"]) - max(start, item["startMs"]) > duration * 0.8 for item in normalized):
            continue
        score = raw.get("score")
        try:
            score = max(0.0, min(100.0, float(score))) if score is not None else None
        except (TypeError, ValueError):
            score = None
        normalized.append({
            "startMs": start,
            "endMs": end,
            "title": str(raw.get("title") or "Найденный момент")[:180],
            "topic": str(raw.get("topic") or "Момент")[:120],
            "explanation": str(raw.get("explanation") or "Законченный фрагмент")[:1000],
            "score": score,
            "warnings": [str(value)[:120] for value in raw.get("warnings", [])[:10]]
            if isinstance(raw.get("warnings"), list) else [],
        })
    requested = config.get("count")
    limit = int(requested) if isinstance(requested, int) else 20
    return normalized[:max(1, min(limit, 50))]


def settings_json(settings: object) -> str:
    return json.dumps(_settings(settings), ensure_ascii=False, separators=(",", ":"))
