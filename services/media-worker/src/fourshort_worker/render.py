from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
import threading
from typing import Iterable

from .config import Settings
from .media import ffmpeg_thread_args
from .process import run_command


def _normalise_source_cuts(edl: dict) -> list[tuple[int, int]]:
    """Return absolute source cuts clamped to the clip's source range.

    ClipEDL v1 stores ranges in source milliseconds.  The renderer works on a
    seeked clip input, so the resulting keep ranges are converted to local
    input time later.  Keeping this conversion explicit prevents the common
    bug where a trim is treated as either absolute time in one stage and clip
    relative time in another.
    """
    clip_range = edl["range"]
    clip_start = int(clip_range["startMs"])
    clip_end = int(clip_range["endMs"])
    cuts: list[tuple[int, int]] = []
    for raw_cut in edl.get("cuts") or []:
        start = max(clip_start, int(raw_cut.get("startMs", clip_start)))
        end = min(clip_end, int(raw_cut.get("endMs", clip_end)))
        if end > start:
            cuts.append((start, end))
    cuts.sort()
    merged: list[tuple[int, int]] = []
    for start, end in cuts:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def build_kept_ranges(edl: dict) -> list[tuple[int, int]]:
    """Build clip-relative keep intervals from source-time source cuts.

    The intervals are half-open millisecond ranges and their order is the
    output clock.  A fully removed clip is a user/input error rather than a
    command that reaches FFmpeg and produces an ambiguous empty file.
    """
    clip_range = edl["range"]
    clip_start = int(clip_range["startMs"])
    clip_end = int(clip_range["endMs"])
    cursor = clip_start
    keep: list[tuple[int, int]] = []
    for cut_start, cut_end in _normalise_source_cuts(edl):
        if cut_start > cursor:
            keep.append((cursor - clip_start, cut_start - clip_start))
        cursor = max(cursor, cut_end)
    if cursor < clip_end:
        keep.append((cursor - clip_start, clip_end - clip_start))
    if not keep:
        raise ValueError("ALL_CLIP_MEDIA_REMOVED")
    return keep


def kept_duration_ms(edl: dict) -> int:
    return sum(end - start for start, end in build_kept_ranges(edl))


@dataclass(frozen=True)
class Hve2TimelineSegment:
    """One source interval on HVE's shared output clock.

    ``transition_in_us`` is deliberately attached to the incoming interval:
    it is the amount by which this interval overlaps the preceding output.
    That keeps video, audio, captions and layout on exactly the same clock.
    """

    start_us: int
    end_us: int
    transition_in_us: int = 0


def build_hve2_timeline(time_map: list[dict]) -> tuple[int, list[Hve2TimelineSegment], int]:
    """Validate the HVE-2 executable map and return local source segments.

    HVE-2 may eventually join multiple sources and apply rational speed changes.
    This first FFmpeg executor intentionally supports only an ordered, 1x map
    for one source.  Rejecting unsupported plans is essential: falling back to
    the old EDL would render a different clip than the planner and corrupt the
    editor's expectation of time.
    """
    if not isinstance(time_map, list) or not time_map:
        raise ValueError("HVE2_TIME_MAP_MISSING")
    source_id: str | None = None
    previous_output_end = 0
    previous_duration = 0
    segments: list[Hve2TimelineSegment] = []
    for index, entry in enumerate(time_map):
        if not isinstance(entry, dict):
            raise ValueError("HVE2_TIME_MAP_INVALID_ENTRY")
        candidate_source = entry.get("sourceId")
        source_range = entry.get("sourceRange")
        output_range = entry.get("outputRange")
        rate = entry.get("rate")
        if not isinstance(candidate_source, str) or not isinstance(source_range, dict) or not isinstance(output_range, dict) or not isinstance(rate, dict):
            raise ValueError("HVE2_TIME_MAP_INVALID_ENTRY")
        if source_id is None:
            source_id = candidate_source
        elif source_id != candidate_source:
            raise ValueError("HVE2_MULTI_SOURCE_TIMELINE_UNSUPPORTED")
        numerator = int(rate.get("numerator", 0))
        denominator = int(rate.get("denominator", 0))
        if numerator != 1 or denominator != 1:
            raise ValueError("HVE2_RATE_CHANGE_UNSUPPORTED")
        source_start, source_end = int(source_range.get("startUs", -1)), int(source_range.get("endUs", -1))
        output_start, output_end = int(output_range.get("startUs", -1)), int(output_range.get("endUs", -1))
        transition_in_us = int(entry.get("transitionInUs", 0) or 0)
        source_duration = source_end - source_start
        if (
            source_start < 0
            or source_end <= source_start
            or transition_in_us < 0
            or transition_in_us > 500_000
            or output_end - output_start != source_duration
        ):
            raise ValueError("HVE2_TIME_MAP_NOT_EXECUTABLE")
        if index == 0:
            if output_start != 0 or transition_in_us != 0:
                raise ValueError("HVE2_TIME_MAP_NOT_EXECUTABLE")
        else:
            if (
                transition_in_us >= previous_duration
                or transition_in_us >= source_duration
                or output_start != previous_output_end - transition_in_us
            ):
                raise ValueError("HVE2_TIME_MAP_NOT_EXECUTABLE")
        segments.append(Hve2TimelineSegment(source_start, source_end, transition_in_us))
        previous_output_end = output_end
        previous_duration = source_duration
    seek_start_us = min(segment.start_us for segment in segments)
    local_segments = [
        Hve2TimelineSegment(
            segment.start_us - seek_start_us,
            segment.end_us - seek_start_us,
            segment.transition_in_us,
        )
        for segment in segments
    ]
    return seek_start_us, local_segments, previous_output_end


def build_hve2_keep_ranges(time_map: list[dict]) -> tuple[int, list[tuple[int, int]]]:
    """Compatibility helper for hard-cut-only callers.

    Callers that only understand concatenation must not silently drop a
    declared crossfade. ``render_clip`` uses :func:`build_hve2_timeline`.
    """
    seek_start_us, segments, _ = build_hve2_timeline(time_map)
    if any(segment.transition_in_us for segment in segments):
        raise ValueError("HVE2_CROSSFADE_KEEP_RANGE_UNSUPPORTED")
    return seek_start_us, [(segment.start_us, segment.end_us) for segment in segments]


def _format_us(value: int) -> str:
    if value < 0:
        raise ValueError("NEGATIVE_MEDIA_TIME")
    seconds, microseconds = divmod(value, 1_000_000)
    return f"{seconds}.{microseconds:06d}"


def _timeline_filter(keep_ranges_us: Iterable[tuple[int, int]], has_audio: bool) -> tuple[str, str, str | None]:
    """Compile source cuts into a decoded A/V concat before visual effects.

    Each retained part resets its timestamp before concat.  The video and
    audio chain share exactly the same keep ranges; no later stage gets to
    apply a different interpretation of a text or pause cut.
    """
    ranges = list(keep_ranges_us)
    if len(ranges) == 1:
        start_us, end_us = ranges[0]
        # A sole range can still be shorter than the seeked input when a cut
        # removed its beginning or end.  Keep explicit trims for correctness.
        video = f"[0:v]trim=start={_format_us(start_us)}:end={_format_us(end_us)},setpts=PTS-STARTPTS[timelinev]"
        if not has_audio:
            return video, "[timelinev]", None
        audio = f"[0:a:0]atrim=start={_format_us(start_us)}:end={_format_us(end_us)},asetpts=PTS-STARTPTS[timelinea]"
        return f"{video};{audio}", "[timelinev]", "[timelinea]"

    chains: list[str] = []
    video_inputs: list[str] = []
    audio_inputs: list[str] = []
    for index, (start_us, end_us) in enumerate(ranges):
        video_label = f"tv{index}"
        chains.append(
            f"[0:v]trim=start={_format_us(start_us)}:end={_format_us(end_us)},setpts=PTS-STARTPTS[{video_label}]"
        )
        video_inputs.append(f"[{video_label}]")
        if has_audio:
            audio_label = f"ta{index}"
            chains.append(
                f"[0:a:0]atrim=start={_format_us(start_us)}:end={_format_us(end_us)},asetpts=PTS-STARTPTS[{audio_label}]"
            )
            audio_inputs.append(f"[{audio_label}]")
    chains.append(f"{''.join(video_inputs)}concat=n={len(ranges)}:v=1:a=0[timelinev]")
    if has_audio:
        chains.append(f"{''.join(audio_inputs)}concat=n={len(ranges)}:v=0:a=1[timelinea]")
        return ";".join(chains), "[timelinev]", "[timelinea]"
    return ";".join(chains), "[timelinev]", None


def _hve2_timeline_filter(
    segments: Iterable[Hve2TimelineSegment],
    has_audio: bool,
) -> tuple[str, str, str | None]:
    """Compile HVE-2 source intervals into a shared A/V output clock.

    Hard cuts remain byte-for-byte equivalent to the existing concat path.
    A declared transition is rendered as a video ``xfade`` plus an audio
    ``acrossfade`` with the same duration. This is intentionally performed
    before the HVE-3 compositor: a static layout then sees the exact output
    clock used by captions, titles and every other layer.
    """
    ordered = list(segments)
    if not ordered:
        raise ValueError("HVE2_TIME_MAP_MISSING")
    if not any(segment.transition_in_us for segment in ordered):
        return _timeline_filter([(segment.start_us, segment.end_us) for segment in ordered], has_audio)

    chains: list[str] = []
    for index, segment in enumerate(ordered):
        video_label = f"hve2vsource{index}"
        chains.append(
            f"[0:v]trim=start={_format_us(segment.start_us)}:end={_format_us(segment.end_us)},"
            f"setpts=PTS-STARTPTS[{video_label}]"
        )
        if has_audio:
            audio_label = f"hve2asource{index}"
            chains.append(
                f"[0:a:0]atrim=start={_format_us(segment.start_us)}:end={_format_us(segment.end_us)},"
                f"asetpts=PTS-STARTPTS[{audio_label}]"
            )

    current_video = "hve2vsource0"
    current_audio = "hve2asource0"
    current_duration_us = ordered[0].end_us - ordered[0].start_us
    for index, segment in enumerate(ordered[1:], start=1):
        output_video = f"hve2vjoin{index}"
        output_audio = f"hve2ajoin{index}"
        segment_duration_us = segment.end_us - segment.start_us
        transition_in_us = segment.transition_in_us
        if transition_in_us:
            if transition_in_us >= current_duration_us or transition_in_us >= segment_duration_us:
                raise ValueError("HVE2_TIME_MAP_NOT_EXECUTABLE")
            chains.append(
                f"[{current_video}][hve2vsource{index}]xfade=transition=fade:"
                f"duration={_format_us(transition_in_us)}:offset={_format_us(current_duration_us - transition_in_us)}"
                f"[{output_video}]"
            )
            if has_audio:
                chains.append(
                    f"[{current_audio}][hve2asource{index}]acrossfade=d={_format_us(transition_in_us)}:"
                    f"c1=tri:c2=tri[{output_audio}]"
                )
            current_duration_us += segment_duration_us - transition_in_us
        else:
            chains.append(f"[{current_video}][hve2vsource{index}]concat=n=2:v=1:a=0[{output_video}]")
            if has_audio:
                chains.append(f"[{current_audio}][hve2asource{index}]concat=n=2:v=0:a=1[{output_audio}]")
            current_duration_us += segment_duration_us
        current_video = output_video
        if has_audio:
            current_audio = output_audio

    chains.append(f"[{current_video}]null[timelinev]")
    if has_audio:
        chains.append(f"[{current_audio}]anull[timelinea]")
        return ";".join(chains), "[timelinev]", "[timelinea]"
    return ";".join(chains), "[timelinev]", None


def _loudness_filter(audio_input: str, audio_policy: dict | None) -> str:
    """Compile bounded, planner-owned loudness normalization.

    The values are constrained again in the worker because render payloads are
    untrusted queue input. Any HVE-2 crossfade has already been expressed in
    the shared time map and compiled into the upstream A/V timeline.
    """
    policy = audio_policy if isinstance(audio_policy, dict) else {}
    target_lufs = float(policy.get("targetLufs", -16))
    true_peak = float(policy.get("truePeakDb", -1.5))
    target_lufs = min(max(target_lufs, -30), -6)
    true_peak = min(max(true_peak, -12), 0)
    return f"{audio_input}loudnorm=I={target_lufs:g}:LRA=11:TP={true_peak:g}[outa]"


def _crop_position_expression(keyframes: list[dict], field: str) -> str:
    ordered = sorted(keyframes, key=lambda item: int(item.get("atMs", 0)))
    if not ordered:
        return "0.5"
    expression = f"{float(ordered[-1].get(field, 0.5)):.6f}"
    for left, right in reversed(list(zip(ordered, ordered[1:]))):
        left_time = int(left.get("atMs", 0)) / 1000
        right_time = int(right.get("atMs", 0)) / 1000
        left_value = float(left.get(field, 0.5))
        right_value = float(right.get(field, 0.5))
        if right_time <= left_time:
            continue
        interpolation = (
            f"{left_value:.6f}+({right_value - left_value:.6f})*"
            f"(t-{left_time:.3f})/{right_time - left_time:.3f}"
        )
        expression = f"if(lt(t\\,{right_time:.3f})\\,{interpolation}\\,{expression})"
    first = ordered[0]
    first_time = int(first.get("atMs", 0)) / 1000
    first_value = float(first.get(field, 0.5))
    return f"if(lt(t\\,{first_time:.3f})\\,{first_value:.6f}\\,{expression})"


def _dynamic_portrait_filter(input_label: str, keyframes: list[dict], width: int, height: int, output_label: str) -> str:
    target_aspect = width / height
    x_expression = _crop_position_expression(keyframes, "x")
    y_expression = _crop_position_expression(keyframes, "y")
    return (
        f"{input_label}crop='min(iw\\,ih*{target_aspect:.10f})':"
        f"'min(ih\\,iw/{target_aspect:.10f})':"
        f"'(iw-ow)*({x_expression})':'(ih-oh)*({y_expression})',"
        f"scale={width}:{height}{output_label}"
    )


def compile_video_filter(edl: dict, ass_path: Path | None, input_label: str = "[0:v]") -> str:
    export = edl["export"]
    width, height = int(export["width"]), int(export["height"])
    layout = edl["layout"]
    mode = layout["mode"]
    crop_track = edl.get("cropTrack") or []
    if mode in {"auto", "active_speaker"} and crop_track:
        chain = _dynamic_portrait_filter(input_label, crop_track, width, height, "[v]")
    elif mode == "two_speakers" and len(edl.get("faceTracks") or []) >= 2:
        first, second = edl["faceTracks"][:2]
        if layout.get("split", "horizontal") == "vertical":
            chain = (
                f"{input_label}split=2[faceA][faceB];"
                + _dynamic_portrait_filter("[faceA]", first["keyframes"], width, height, "[portraitA]") + ";"
                + _dynamic_portrait_filter("[faceB]", second["keyframes"], width, height, "[portraitB]") + ";"
                + f"[portraitA]crop={width // 2}:{height}:0:0[left];"
                + f"[portraitB]crop={width // 2}:{height}:{width // 2}:0[right];"
                + "[left][right]hstack=inputs=2[v]"
            )
        else:
            chain = (
                f"{input_label}split=2[faceA][faceB];"
                + _dynamic_portrait_filter("[faceA]", first["keyframes"], width, height, "[portraitA]") + ";"
                + _dynamic_portrait_filter("[faceB]", second["keyframes"], width, height, "[portraitB]") + ";"
                + f"[portraitA]crop={width}:{height // 2}:0:0[top];"
                + f"[portraitB]crop={width}:{height // 2}:0:{height // 2}[bottom];"
                + "[top][bottom]vstack=inputs=2[v]"
            )
    elif mode == "blur_background":
        chain = (
            f"{input_label}split=2[bg][fg];"
            f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=24:12[blur];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[front];"
            f"[blur][front]overlay=(W-w)/2:(H-h)/2[v]"
        )
    elif mode == "static_crop":
        # x/y are normalized (0-1) positions of the crop window along the
        # slack left over after the fill-scale, not raw pixel offsets — 0.5
        # each reproduces the plain centre-crop the old unconditional branch
        # always did, and this is the first place the "else" branch's silent
        # x/y/zoom == "static_crop's own documented, contract-accepted
        # params (packages/contracts/src/media.ts) were previously ignored.
        zoom = max(float(layout.get("zoom", 1)), 1.0)
        x_norm = min(max(float(layout.get("x", 0.5)), 0.0), 1.0)
        y_norm = min(max(float(layout.get("y", 0.5)), 0.0), 1.0)
        scale_w, scale_h = round(width * zoom), round(height * zoom)
        chain = (
            f"{input_label}scale={scale_w}:{scale_h}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:'(iw-{width})*{x_norm}':'(ih-{height})*{y_norm}'[v]"
        )
    else:
        # auto and every not-yet-implemented tracking-dependent mode
        # (active_speaker/two_speakers/picture_in_picture/screen_gameplay —
        # see the `clip-formats` skill for which are still UI-locked) fall
        # back to the same plain centre-crop as before.
        chain = (
            f"{input_label}scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}[v]"
        )
    if ass_path:
        escaped = str(ass_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        chain += f";[v]ass='{escaped}'[outv]"
    else:
        chain += ";[v]null[outv]"
    return chain


def _crop_keyframes_from_plan(slot: dict, output_range: dict) -> tuple[dict, list[dict]]:
    """Validate an HVE crop track without silently freezing it.

    Crop rectangles use HVE's normalized *source* coordinates (top-left x/y,
    width/height). FFmpeg can reliably evaluate crop x/y on every output frame,
    but crop width/height are configured once. Therefore this first dynamic
    executor accepts a moving window with a constant size and refuses a zoom
    track rather than rendering its first keyframe as an incorrect result.

    The planner must span the resolved segment exactly. That makes the worker a
    deterministic consumer of an output-clock plan; it never guesses what a
    missing beginning or end keyframe should mean.
    """
    keyframes = slot.get("cropKeyframes") or []
    if not keyframes:
        raise ValueError("HVE3_SLOT_CROP_MISSING")
    if not isinstance(output_range, dict):
        raise ValueError("HVE3_LAYOUT_TIMELINE_MISMATCH")
    start_us = int(output_range.get("startUs", -1))
    end_us = int(output_range.get("endUs", -1))
    if start_us < 0 or end_us <= start_us:
        raise ValueError("HVE3_LAYOUT_TIMELINE_MISMATCH")

    parsed: list[dict] = []
    previous_at_us: int | None = None
    for item in keyframes:
        if not isinstance(item, dict) or not isinstance(item.get("crop"), dict):
            raise ValueError("HVE3_SLOT_CROP_INVALID")
        at_us = int(item.get("atUs", -1))
        crop = item["crop"]
        fields = {name: float(crop.get(name, -1)) for name in ("x", "y", "width", "height")}
        if (
            at_us < start_us
            or at_us >= end_us
            or (previous_at_us is not None and at_us <= previous_at_us)
            or fields["x"] < 0
            or fields["y"] < 0
            or fields["width"] <= 0
            or fields["height"] <= 0
            or fields["x"] + fields["width"] > 1
            or fields["y"] + fields["height"] > 1
        ):
            raise ValueError("HVE3_SLOT_CROP_INVALID")
        parsed.append({"atUs": at_us, "crop": fields})
        previous_at_us = at_us
    if parsed[0]["atUs"] != start_us or parsed[-1]["atUs"] != end_us - 1:
        raise ValueError("HVE3_SLOT_CROP_COVERAGE_INVALID")

    first = parsed[0]["crop"]
    for keyframe in parsed[1:]:
        crop = keyframe["crop"]
        if abs(crop["width"] - first["width"]) > 1e-8 or abs(crop["height"] - first["height"]) > 1e-8:
            raise ValueError("HVE3_DYNAMIC_CROP_SIZE_UNSUPPORTED")
    return first, parsed


def _hve3_crop_position_expression(keyframes: list[dict], field: str, *, output_offset_us: int = 0) -> str:
    """Return a per-frame piecewise-linear source-coordinate expression.

    A source-only layout segment is trimmed from the shared contiguous output
    stream and reset to PTS zero before its slot graph runs. `output_offset_us`
    converts absolute HVE output-clock keyframes to that segment-local FFmpeg
    `t`; omitting it preserves the original full-clip behaviour. Commas are
    escaped for filtergraph parsing; numbers are rendered with fixed precision
    for stable render hashes.
    """
    if all(abs(keyframe["crop"][field] - keyframes[0]["crop"][field]) <= 1e-8 for keyframe in keyframes[1:]):
        return f"{keyframes[0]['crop'][field]:.8f}"
    expression = f"{keyframes[-1]['crop'][field]:.8f}"
    for left, right in reversed(list(zip(keyframes, keyframes[1:]))):
        left_time = (left["atUs"] - output_offset_us) / 1_000_000
        right_time = (right["atUs"] - output_offset_us) / 1_000_000
        left_value = left["crop"][field]
        right_value = right["crop"][field]
        duration = right_time - left_time
        interpolation = (
            f"{left_value:.8f}+({right_value - left_value:.8f})*"
            f"(t-{left_time:.6f})/{duration:.6f}"
        )
        expression = f"if(lt(t\\,{right_time:.6f})\\,{interpolation}\\,{expression})"
    return expression


def compile_resolved_layout_filter(
    resolved_layout_segments: list[dict],
    export: dict,
    ass_path: Path | None,
    input_label: str = "[timelinev]",
    static_image_layers: list[dict] | None = None,
    timed_video_layers: list[dict] | None = None,
) -> str:
    """Compile contiguous source-only HVE-3 layout segments without template branches.

    The planner owns every output range and rounds every rectangle. The worker
    never infers a layout: it trims each verified output-clock segment from the
    already stitched A/V video, composes its source slots, then concatenates
    those visual segments back on the exact same output clock. Layout changes
    are deliberate hard cuts for now. Crossfades or other transitions need a
    timing contract that shifts all dependent captions/layers, and therefore
    remain unsupported rather than being approximated by FFmpeg.
    """
    if not isinstance(resolved_layout_segments, list) or not resolved_layout_segments:
        raise ValueError("HVE3_LAYOUT_SEGMENT_COUNT_UNSUPPORTED")
    width, height, fps = int(export["width"]), int(export["height"]), int(export.get("fps", 30))
    if width <= 0 or height <= 0 or fps <= 0:
        raise ValueError("HVE3_CANVAS_INVALID")
    chains: list[str] = []
    segment_outputs: list[str] = []
    cursor_us = 0
    multi_segment = len(resolved_layout_segments) > 1
    # FFmpeg filter labels are single-consumer. A hard layout cut needs to
    # read the already stitched HVE output clock more than once, so fork it
    # before trimming segment-local canvases. Reusing `[timelinev]` directly
    # works for one segment but fails at runtime as an invalid stream
    # specifier for the second one.
    segment_timeline_labels = [
        f"hve3timeline{index}" for index in range(len(resolved_layout_segments))
    ] if multi_segment else []
    if multi_segment:
        chains.append(
            f"{input_label}split={len(segment_timeline_labels)}"
            f"{''.join(f'[{label}]' for label in segment_timeline_labels)}"
        )
    for segment_index, segment in enumerate(resolved_layout_segments):
        if not isinstance(segment, dict):
            raise ValueError("HVE3_LAYOUT_SLOTS_INVALID")
        output_range = segment.get("outputRange")
        slots = segment.get("slots")
        if not isinstance(output_range, dict):
            raise ValueError("HVE3_LAYOUT_TIMELINE_MISMATCH")
        start_us, end_us = int(output_range.get("startUs", -1)), int(output_range.get("endUs", -1))
        if start_us != cursor_us or end_us <= start_us:
            raise ValueError("HVE3_LAYOUT_TIMELINE_MISMATCH")
        cursor_us = end_us
        if not isinstance(slots, list) or not slots or len(slots) > 4:
            raise ValueError("HVE3_LAYOUT_SLOTS_INVALID")
        for slot in slots:
            if not isinstance(slot, dict):
                raise ValueError("HVE3_LAYOUT_SLOTS_INVALID")
            source = slot.get("source")
            if not isinstance(source, dict) or source.get("kind") != "source":
                raise ValueError("HVE3_REGION_ARTIFACT_REQUIRED")

        suffix = f"s{segment_index}" if multi_segment else ""
        segment_input_label = f"hve3segmentinput{suffix}"
        start_seconds = f"{start_us / 1_000_000:.6f}"
        end_seconds = f"{end_us / 1_000_000:.6f}"
        segment_timeline_input = f"[{segment_timeline_labels[segment_index]}]" if multi_segment else input_label
        chains.append(f"{segment_timeline_input}trim=start={start_seconds}:end={end_seconds},setpts=PTS-STARTPTS[{segment_input_label}]")
        has_blur_background = any(slot.get("background") == "blur" for slot in slots)
        split_count = len(slots) + (1 if has_blur_background else 0)
        labels = [f"hve3{suffix}slot{index}" for index in range(len(slots))]
        split_labels = ([f"hve3{suffix}bg"] if has_blur_background else []) + labels
        chains.append(f"[{segment_input_label}]split={split_count}{''.join(f'[{label}]' for label in split_labels)}")
        base_label = f"hve3{suffix}base"
        if has_blur_background:
            chains.append(
                f"[hve3{suffix}bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height},boxblur=24:12[{base_label}]"
            )
        else:
            chains.append(f"color=c=black:s={width}x{height}:r={fps}[{base_label}]")

        for slot_index, (slot, input_slot_label) in enumerate(zip(slots, labels)):
            destination = slot.get("destinationPx")
            if not isinstance(destination, dict):
                raise ValueError("HVE3_SLOT_DESTINATION_INVALID")
            x, y = int(destination.get("x", -1)), int(destination.get("y", -1))
            slot_width, slot_height = int(destination.get("width", 0)), int(destination.get("height", 0))
            if x < 0 or y < 0 or slot_width <= 0 or slot_height <= 0 or x + slot_width > width or y + slot_height > height:
                raise ValueError("HVE3_SLOT_DESTINATION_OUT_OF_BOUNDS")
            crop, crop_keyframes = _crop_keyframes_from_plan(slot, output_range)
            x_expression = _hve3_crop_position_expression(crop_keyframes, "x", output_offset_us=start_us)
            y_expression = _hve3_crop_position_expression(crop_keyframes, "y", output_offset_us=start_us)
            crop_filter = (
                f"crop='iw*{crop['width']:.8f}':'ih*{crop['height']:.8f}':"
                f"'iw*({x_expression})':'ih*({y_expression})'"
            )
            fit = slot.get("fit")
            content_label = f"hve3{suffix}content{slot_index}"
            if fit in {"cover", "smart_cover"}:
                chains.append(
                    f"[{input_slot_label}]{crop_filter},"
                    f"scale={slot_width}:{slot_height}:force_original_aspect_ratio=increase,"
                    f"crop={slot_width}:{slot_height}[{content_label}]"
                )
                overlay_x, overlay_y = str(x), str(y)
            elif fit == "contain":
                chains.append(
                    f"[{input_slot_label}]{crop_filter},"
                    f"scale={slot_width}:{slot_height}:force_original_aspect_ratio=decrease[{content_label}]"
                )
                overlay_x = f"{x}+(%s-w)/2" % slot_width
                overlay_y = f"{y}+(%s-h)/2" % slot_height
            else:
                raise ValueError("HVE3_SLOT_FIT_INVALID")
            output_label = f"hve3{suffix}canvas{slot_index}"
            chains.append(f"[{base_label}][{content_label}]overlay=x={overlay_x}:y={overlay_y}:shortest=1[{output_label}]")
            base_label = output_label
        segment_output = f"hve3segment{segment_index}"
        chains.append(f"[{base_label}]setpts=PTS-STARTPTS[{segment_output}]")
        segment_outputs.append(segment_output)

    if multi_segment:
        chains.append(f"{''.join(f'[{label}]' for label in segment_outputs)}concat=n={len(segment_outputs)}:v=1:a=0[hve3layout]")
        base_label = "hve3layout"
    else:
        base_label = segment_outputs[0]

    # Static and timed visual assets use separate FFmpeg input preparation,
    # but share one sorted compositor order. Splitting these loops would make
    # a low-z video paint over a high-z logo merely because of its media type.
    # Inputs remain stable (all static first, then timed) while composition is
    # ordered only by planner-owned zIndex/layerId.
    static_layers = static_image_layers or []
    timed_layers = timed_video_layers or []
    compositing_inputs = [
        ("static", index + 1, layer)
        for index, layer in enumerate(static_layers)
    ] + [
        ("timed", len(static_layers) + index + 1, layer)
        for index, layer in enumerate(timed_layers)
    ]
    compositing_inputs.sort(key=lambda item: (int(item[2].get("zIndex", 0)) if isinstance(item[2], dict) else -1, str(item[2].get("layerId", "")) if isinstance(item[2], dict) else ""))
    for composite_index, (kind, input_index, layer) in enumerate(compositing_inputs):
        if not isinstance(layer, dict):
            raise ValueError("HVE_PRODUCTION_LAYER_INVALID")
        destination = layer.get("destinationPx")
        output_range = layer.get("outputRange")
        if not isinstance(destination, dict) or not isinstance(output_range, dict):
            raise ValueError("HVE_PRODUCTION_LAYER_INVALID")
        x, y = int(destination.get("x", -1)), int(destination.get("y", -1))
        layer_width, layer_height = int(destination.get("width", 0)), int(destination.get("height", 0))
        start_us, end_us = int(output_range.get("startUs", -1)), int(output_range.get("endUs", -1))
        opacity = float(layer.get("opacity", -1))
        path = layer.get("path")
        if (
            not isinstance(path, str)
            or x < 0 or y < 0 or layer_width <= 0 or layer_height <= 0
            or x + layer_width > width or y + layer_height > height
            or start_us < 0 or end_us <= start_us
            or not 0 <= opacity <= 1
        ):
            raise ValueError("HVE_PRODUCTION_LAYER_INVALID")
        content_label = f"hve3layercontent{composite_index}"
        output_label = f"hve3layercanvas{composite_index}"
        start_seconds = f"{start_us / 1_000_000:.6f}"
        end_seconds = f"{end_us / 1_000_000:.6f}"
        alpha = f"{opacity:.6f}"
        if kind == "static":
            if layer.get("type") not in {"image", "logo", "banner"}:
                raise ValueError("HVE_STATIC_ASSET_LAYER_INVALID")
            chains.append(
                f"[{input_index}:v]scale={layer_width}:{layer_height}:force_original_aspect_ratio=decrease,"
                f"format=rgba,colorchannelmixer=aa={alpha}[{content_label}]"
            )
            overlay_tail = "shortest=1"
        elif kind == "timed":
            layer_type = layer.get("type")
            if layer_type == "video" and isinstance(layer.get("loop"), bool):
                force_aspect = "decrease"
            elif layer_type == "broll":
                if (
                    layer.get("muted") is not True
                    or layer.get("visualPolicy") != "replace_full_canvas_keep_narrative_audio"
                    or layer.get("fit") != "cover"
                    or opacity != 1
                    or x != 0 or y != 0 or layer_width != width or layer_height != height
                    or int(layer.get("zIndex", -1)) < 0 or int(layer.get("zIndex", -1)) > 5
                ):
                    raise ValueError("HVE_BROLL_RENDER_POLICY_INVALID")
                force_aspect = "increase,crop=%d:%d" % (layer_width, layer_height)
            else:
                raise ValueError("HVE_TIMED_VIDEO_LAYER_INVALID")
            layer_duration_seconds = f"{(end_us - start_us) / 1_000_000:.6f}"
            chains.append(
                f"[{input_index}:v]trim=duration={layer_duration_seconds},setpts=PTS-STARTPTS+{start_seconds}/TB,"
                f"scale={layer_width}:{layer_height}:force_original_aspect_ratio={force_aspect},"
                f"format=rgba,colorchannelmixer=aa={alpha}[{content_label}]"
            )
            overlay_tail = "eof_action=pass:shortest=0"
        else:
            raise ValueError("HVE_PRODUCTION_LAYER_INVALID")
        chains.append(
            f"[{base_label}][{content_label}]overlay=x={x}+({layer_width}-w)/2:y={y}+({layer_height}-h)/2:"
            f"{overlay_tail}:enable='between(t\\,{start_seconds}\\,{end_seconds})'[{output_label}]"
        )
        base_label = output_label

    if ass_path:
        escaped = str(ass_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        chains.append(f"[{base_label}]ass='{escaped}'[outv]")
    else:
        chains.append(f"[{base_label}]null[outv]")
    return ";".join(chains)


def render_clip(
    settings: Settings,
    input_url: str,
    edl: dict,
    ass_path: Path | None,
    output: Path,
    *,
    has_audio: bool = True,
    process_metrics: dict[str, int | float] | None = None,
    hve2_time_map: list[dict] | None = None,
    audio_policy: dict | None = None,
    resolved_layout_segments: list[dict] | None = None,
    static_image_layers: list[dict] | None = None,
    timed_video_layers: list[dict] | None = None,
    cancellation_event: threading.Event | None = None,
) -> int:
    if hve2_time_map is not None:
        seek_start_us, hve2_segments, duration_us = build_hve2_timeline(hve2_time_map)
        keep_ranges_us = [(segment.start_us, segment.end_us) for segment in hve2_segments]
    else:
        seek_start_us = int(edl["range"]["startMs"]) * 1_000
        keep_ranges_us = [(start_ms * 1_000, end_ms * 1_000) for start_ms, end_ms in build_kept_ranges(edl)]
        hve2_segments = None
        duration_us = sum(end_us - start_us for start_us, end_us in keep_ranges_us)
    duration_ms = math.ceil(duration_us / 1_000)
    duration_seconds = duration_us / 1_000_000
    export = edl["export"]
    if resolved_layout_segments is not None:
        if not isinstance(resolved_layout_segments, list) or not resolved_layout_segments or not isinstance(resolved_layout_segments[-1], dict):
            raise ValueError("HVE3_LAYOUT_SEGMENT_COUNT_UNSUPPORTED")
        output_range = resolved_layout_segments[-1].get("outputRange")
        if not isinstance(output_range, dict) or int(output_range.get("endUs", -1)) != duration_us:
            raise ValueError("HVE3_LAYOUT_TIMELINE_MISMATCH")
    timeline_filter, video_input, audio_input = (
        _hve2_timeline_filter(hve2_segments, has_audio)
        if hve2_segments is not None
        else _timeline_filter(keep_ranges_us, has_audio)
    )
    visual_filter = (
        compile_resolved_layout_filter(
            resolved_layout_segments,
            export,
            ass_path,
            video_input,
            static_image_layers,
            timed_video_layers,
        )
        if resolved_layout_segments is not None
        else compile_video_filter(edl, ass_path, video_input)
    )
    filters = [timeline_filter, visual_filter]
    command = [
        settings.ffmpeg_path,
        "-hide_banner", "-nostdin", "-y",
        *ffmpeg_thread_args(settings, filtergraph=True),
        "-ss", _format_us(seek_start_us),
        "-i", input_url,
    ]
    for layer in static_image_layers or []:
        path = layer.get("path") if isinstance(layer, dict) else None
        if not isinstance(path, str):
            raise ValueError("HVE_STATIC_ASSET_LAYER_INVALID")
        command.extend(["-loop", "1", "-framerate", str(export.get("fps", 30)), "-i", path])
    for layer in timed_video_layers or []:
        if not isinstance(layer, dict) or layer.get("type") not in {"video", "broll"}:
            raise ValueError("HVE_TIMED_VIDEO_LAYER_INVALID")
        path = layer.get("path")
        loop = layer.get("loop")
        if not isinstance(path, str):
            raise ValueError("HVE_TIMED_VIDEO_LAYER_INVALID")
        if layer.get("type") == "video" and not isinstance(loop, bool):
            raise ValueError("HVE_TIMED_VIDEO_LAYER_INVALID")
        if layer.get("type") == "broll" and loop is not None:
            raise ValueError("HVE_BROLL_RENDER_POLICY_INVALID")
        if loop is True:
            command.extend(["-stream_loop", "-1"])
        # Deliberately omit audio stream selection: the timed-layer contract
        # is visual-only until an explicit audio-mix policy exists.
        command.extend(["-i", path])
    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", "[outv]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-r", str(export.get("fps", 30)),
        "-b:v", f"{export.get('videoBitrateKbps', 6500)}k",
        "-maxrate", f"{int(export.get('videoBitrateKbps', 6500) * 1.25)}k",
        "-bufsize", f"{int(export.get('videoBitrateKbps', 6500) * 2)}k",
        "-movflags", "+faststart",
    ])
    if audio_input:
        # Loudness is an audio policy, so it remains in the same filter graph
        # as the concat.  This prevents the original (uncut) audio stream from
        # being mapped after video source cuts.
        command[command.index("-map") + 2:command.index("-c:v")] = ["-map", "[outa]"]
        filters[-1] = f"{visual_filter};{_loudness_filter(audio_input, audio_policy)}"
        command[command.index("-filter_complex") + 1] = ";".join(filters)
        command.extend(["-c:a", "aac", "-b:a", f"{export.get('audioBitrateKbps', 160)}k"])
    else:
        command.append("-an")
    command.append(str(output))
    run_command(
        command,
        timeout_seconds=max(600, int(duration_seconds * 30)),
        process_metrics=process_metrics,
        cancellation_event=cancellation_event,
    )
    return duration_ms
