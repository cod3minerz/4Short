from __future__ import annotations

from pathlib import Path
import re


def ass_time(milliseconds: int) -> str:
    total_centiseconds = max(milliseconds, 0) // 10
    hours, remainder = divmod(total_centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def ass_color(hex_color: str, alpha: str = "00") -> str:
    value = hex_color.lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        value = "ffffff"
    red, green, blue = value[0:2], value[2:4], value[4:6]
    return f"&H{alpha}{blue}{green}{red}&"


def escape_ass(value: str) -> str:
    return value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def _caption_time(milliseconds: int, separator: str) -> str:
    """Format an output-clock timestamp for an interchange caption file."""
    value = max(0, int(milliseconds))
    hours, remainder = divmod(value, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, fraction = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{fraction:03d}"


def _interchange_text(cue: dict) -> str:
    """Make SRT/VTT a plain-text export, not an untrusted markup channel.

    The render plan owns timing, while this function only serializes the
    already-resolved visible wording. Newlines deliberately remain line
    breaks; VTT timing delimiters and control characters do not.
    """
    value = str(cue.get("text", ""))
    if not value:
        value = " ".join(str(word.get("text", "")).strip() for word in cue.get("words", [])).strip()
    lines = []
    for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        cleaned = "".join(character for character in line if character >= " " or character == "\t")
        # A VTT cue payload containing --> can be parsed as a new timing line
        # by some players. It is display text, so preserve meaning safely.
        lines.append(cleaned.replace("-->", "→").strip())
    return "\n".join(line for line in lines if line)


def _interchange_cues(cues: list[dict]):
    for cue in cues:
        try:
            start_ms, end_ms = int(cue["startMs"]), int(cue["endMs"])
        except (KeyError, TypeError, ValueError):
            continue
        text = _interchange_text(cue)
        if end_ms > start_ms and text:
            yield start_ms, end_ms, text


def write_srt(path: Path, cues: list[dict]) -> None:
    """Write resolved HVE output-clock captions as a standalone SRT file."""
    blocks = [
        f"{index}\n{_caption_time(start_ms, ',')} --> {_caption_time(end_ms, ',')}\n{text}"
        for index, (start_ms, end_ms, text) in enumerate(_interchange_cues(cues), start=1)
    ]
    path.write_text("\n\n".join(blocks) + ("\n" if blocks else ""), encoding="utf-8")


def write_vtt(path: Path, cues: list[dict]) -> None:
    """Write resolved HVE output-clock captions as a UTF-8 WebVTT file."""
    blocks = [
        f"{_caption_time(start_ms, '.')} --> {_caption_time(end_ms, '.')}\n{text}"
        for start_ms, end_ms, text in _interchange_cues(cues)
    ]
    path.write_text("WEBVTT\n\n" + "\n\n".join(blocks) + ("\n" if blocks else ""), encoding="utf-8")


def _font_weight(config: dict) -> int:
    return -1 if int(config.get("fontWeight", 800)) >= 600 else 0


def _style_values(config: dict) -> dict:
    preset = str(config.get("preset", "clean"))
    background = bool(config.get("background", False)) or preset == "minimal_box"
    outline_px = float(config.get("outlinePx", 4))
    shadow = 2 if bool(config.get("shadow", True)) else 0
    if preset == "bold":
        outline_px = max(outline_px, 6)
    if preset in {"karaoke", "pulse"}:
        shadow = max(shadow, 3)
    return {
        "border_style": 3 if background else 1,
        "outline": outline_px,
        "shadow": shadow,
        "back": "&H99000000&" if background else "&H66000000&",
    }


def _chunk_words(words: list[dict], max_words: int) -> list[list[dict]]:
    return [words[index:index + max_words] for index in range(0, len(words), max_words)]


def _word_text(word: dict, uppercase: bool) -> str:
    value = escape_ass(str(word.get("text", "")).strip())
    return value.upper() if uppercase else value


def _line_dialogues(cue: dict, config: dict) -> list[tuple[int, int, str]]:
    uppercase = bool(config.get("uppercase", False))
    max_words = max(1, int(config.get("maxWordsPerLine", 5)))
    words = [word for word in cue.get("words", []) if int(word.get("endMs", 0)) > int(word.get("startMs", 0))]
    if not words:
        text = escape_ass(str(cue.get("text", "")))
        if uppercase:
            text = text.upper()
        return [(int(cue["startMs"]), int(cue["endMs"]), text)] if text else []
    return [
        (
            int(chunk[0]["startMs"]),
            int(chunk[-1]["endMs"]),
            " ".join(_word_text(word, uppercase) for word in chunk),
        )
        for chunk in _chunk_words(words, max_words)
        if chunk
    ]


def _active_word_dialogues(cue: dict, config: dict, active_color: str) -> list[tuple[int, int, str]]:
    uppercase = bool(config.get("uppercase", False))
    max_words = max(1, int(config.get("maxWordsPerLine", 5)))
    # `pulse` is kept for styles saved before HVE v2.  The public picker now
    # calls this same treatment `word_pop`; both identities must yield a real
    # visual distinction rather than only changing a value in the document.
    pulse = str(config.get("preset", "")) in {"pulse", "word_pop"}
    words = [word for word in cue.get("words", []) if int(word.get("endMs", 0)) > int(word.get("startMs", 0))]
    if not words:
        return _line_dialogues(cue, config)
    events: list[tuple[int, int, str]] = []
    for chunk in _chunk_words(words, max_words):
        for active_index, active_word in enumerate(chunk):
            rendered: list[str] = []
            for index, word in enumerate(chunk):
                text = _word_text(word, uppercase)
                if index == active_index:
                    transform = "\\fscx112\\fscy112" if pulse else ""
                    text = f"{{\\c{active_color}{transform}}}{text}{{\\rDefault}}"
                rendered.append(text)
            events.append((int(active_word["startMs"]), int(active_word["endMs"]), " ".join(rendered)))
    return events


def _word_pop_dialogues(cue: dict, config: dict, active_color: str) -> list[tuple[int, int, str]]:
    """Render each timed word as a short, explicit ASS pop event.

    The editor maps the Word Pop preset to ``word_by_word`` timing.  Keeping
    the transform in the renderer makes that mapping deterministic for every
    rerender and prevents the preset from silently degrading to plain text.
    """
    uppercase = bool(config.get("uppercase", False))
    events: list[tuple[int, int, str]] = []
    for word in cue.get("words", []):
        start_ms, end_ms = int(word.get("startMs", 0)), int(word.get("endMs", 0))
        if end_ms <= start_ms:
            continue
        text = _word_text(word, uppercase)
        if not text:
            continue
        # Start just above final size and settle in the first 80 ms.  ASS
        # timings remain tied to the immutable word timestamps; no synthetic
        # frame clock or browser-only animation is introduced here.
        events.append((
            start_ms,
            end_ms,
            f"{{\\c{active_color}\\fscx116\\fscy116\\t(0,80,\\fscx100\\fscy100)}}{text}{{\\rDefault}}",
        ))
    return events


def _karaoke_dialogues(cue: dict, config: dict) -> list[tuple[int, int, str]]:
    uppercase = bool(config.get("uppercase", False))
    max_words = max(1, int(config.get("maxWordsPerLine", 5)))
    words = [word for word in cue.get("words", []) if int(word.get("endMs", 0)) > int(word.get("startMs", 0))]
    if not words:
        return _line_dialogues(cue, config)
    events: list[tuple[int, int, str]] = []
    for chunk in _chunk_words(words, max_words):
        parts: list[str] = []
        cursor = int(chunk[0]["startMs"])
        for word in chunk:
            start_ms, end_ms = int(word["startMs"]), int(word["endMs"])
            prefix = ""
            if start_ms > cursor:
                prefix = f"{{\\k{max(1, (start_ms - cursor) // 10)}}}"
            parts.append(f"{prefix}{{\\kf{max(1, (end_ms - start_ms) // 10)}}}{_word_text(word, uppercase)}")
            cursor = end_ms
        events.append((int(chunk[0]["startMs"]), int(chunk[-1]["endMs"]), " ".join(parts)))
    return events


def _speaker_color(speaker_id: str | None, config: dict) -> str | None:
    if not speaker_id or str(config.get("preset")) != "speaker_colors":
        return None
    palette = [
        config.get("activeColor", "#10b8f4"),
        "#ffd166", "#8ce99a", "#ff8fab", "#c0a7ff",
    ]
    index = sum(ord(character) for character in speaker_id) % len(palette)
    return ass_color(str(palette[index]))


def write_ass(
    path: Path,
    cues: list[dict],
    config: dict,
    width: int,
    height: int,
    title: dict | None = None,
    production_text_layers: list[dict] | None = None,
) -> None:
    font_size = int(config.get("fontSize", 58))
    margin_v = int(config.get("safeMarginPx", 160))
    alignment = {"top": 8, "center": 5, "bottom": 2}.get(config.get("position"), 2)
    primary = ass_color(config.get("color", "#ffffff"))
    active = ass_color(config.get("activeColor", "#10b8f4"))
    outline = ass_color(config.get("outlineColor", "#06131a"))
    style = _style_values(config)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,{config.get("fontFamily", "Manrope")},{font_size},{primary},{active},{outline},{style['back']},{_font_weight(config)},0,0,0,100,100,0,0,{style['border_style']},{style['outline']},{style['shadow']},{alignment},60,60,{margin_v},1
Style: Title,{config.get("fontFamily", "Manrope")},{max(font_size + 12, 68)},{primary},{active},{outline},&H88000000&,-1,0,0,0,100,100,0,0,1,{max(style['outline'], 5)},2,8,72,72,120,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    lines = [header]
    mode = str(config.get("mode", "active_word"))
    for cue in cues:
        if mode == "word_by_word":
            if str(config.get("preset", "")) in {"word_pop", "pulse"}:
                events = _word_pop_dialogues(cue, config, active) or _line_dialogues(cue, config)
            else:
                events = [
                    (int(word["startMs"]), int(word["endMs"]), _word_text(word, bool(config.get("uppercase", False))))
                    for word in cue.get("words", [])
                    if int(word.get("endMs", 0)) > int(word.get("startMs", 0))
                ] or _line_dialogues(cue, config)
        elif mode == "karaoke" or str(config.get("preset")) == "karaoke":
            events = _karaoke_dialogues(cue, config)
        elif mode == "active_word":
            events = _active_word_dialogues(cue, config, active)
        else:
            events = _line_dialogues(cue, config)

        speaker_color = _speaker_color(cue.get("speakerId"), config)
        for start_ms, end_ms, text in events:
            if not text or end_ms <= start_ms:
                continue
            prefix = f"{{\\c{speaker_color}}}" if speaker_color else ""
            lines.append(
                f"Dialogue: 0,{ass_time(start_ms)},{ass_time(end_ms)},Default,,0,0,0,,{prefix}{text}\n"
            )
    if title and str(title.get("text", "")).strip():
        anchor = str(title.get("anchor", "top_center"))
        alignment_by_anchor = {
            "top_left": 7, "top_center": 8, "top_right": 9,
            "center_left": 4, "center": 5, "center_right": 6,
            "bottom_left": 1, "bottom_center": 2, "bottom_right": 3,
        }
        title_text = escape_ass(str(title["text"]).strip())
        alignment_override = alignment_by_anchor.get(anchor, 8)
        lines.append(
            f"Dialogue: 1,{ass_time(int(title.get('startMs', 0)))},"
            f"{ass_time(int(title.get('endMs', 5_000)))},Title,,0,0,0,,"
            f"{{\\an{alignment_override}}}{title_text}\n"
        )
    for layer in sorted(production_text_layers or [], key=lambda item: (int(item.get("zIndex", 0)), str(item.get("layerId", "")))):
        # Resolved plans are untrusted queue payloads at this boundary. Reject
        # malformed layers instead of moving/guessing geometry.  A text layer
        # is positioned and clipped in its resolved pixel box so the browser
        # and final render share one geometry contract.
        output_range = layer.get("outputRange") if isinstance(layer, dict) else None
        destination = layer.get("destinationPx") if isinstance(layer, dict) else None
        style_data = layer.get("style") if isinstance(layer, dict) else None
        if (
            not isinstance(output_range, dict)
            or not isinstance(destination, dict)
            or not isinstance(style_data, dict)
            or layer.get("type") != "text"
            or style_data.get("id") != "hve-title-v1"
        ):
            raise ValueError("HVE3_TEXT_LAYER_INVALID")
        start_us, end_us = int(output_range.get("startUs", -1)), int(output_range.get("endUs", -1))
        x, y = int(destination.get("x", -1)), int(destination.get("y", -1))
        box_width, box_height = int(destination.get("width", 0)), int(destination.get("height", 0))
        opacity = float(layer.get("opacity", -1))
        if (
            start_us < 0 or end_us <= start_us or x < 0 or y < 0
            or box_width <= 0 or box_height <= 0 or x + box_width > width or y + box_height > height
            or opacity < 0 or opacity > 1
        ):
            raise ValueError("HVE3_TEXT_LAYER_INVALID")
        text = escape_ass(str(layer.get("text", "")).strip())
        if not text:
            raise ValueError("HVE3_TEXT_LAYER_INVALID")
        font_size = min(240, max(16, int(style_data.get("fontSizePx", 72))))
        font_weight = -1 if int(style_data.get("fontWeight", 700)) >= 600 else 0
        primary = ass_color(str(style_data.get("color", "#ffffff")), f"{round((1 - opacity) * 255):02X}")
        outline = ass_color(str(style_data.get("outlineColor", "#06131a")))
        outline_px = min(24, max(0, float(style_data.get("outlinePx", 3))))
        background = bool(style_data.get("background", True))
        # ASS styles must be declared before [Events]. Rather than depend on a
        # renderer-side dynamic style name, use inline overrides on the stable
        # Title style. `\\clip` constrains the text to exactly the planner box.
        start_ms = start_us // 1_000
        end_ms = (end_us + 999) // 1_000
        alpha = f"{round((1 - opacity) * 255):02X}"
        # `Style` declarations after [Events] are invalid ASS.  The stable
        # Title style supplies compatible defaults; per-layer overrides carry
        # the immutable resolved values below.
        override = (
            f"{{\\an7\\pos({x},{y})\\clip({x},{y},{x + box_width},{y + box_height})"
            f"\\fn{escape_ass(str(style_data.get('fontFamily', 'Manrope')))}"
            f"\\fs{font_size}\\b{font_weight}\\c{primary}\\3c{outline}"
            f"\\bord{outline_px:g}\\alpha&H{alpha}&\\bord{outline_px:g}"
            f"\\shad{2 if background else 0}}}"
        )
        lines.append(
            f"Dialogue: {max(2, int(layer.get('zIndex', 0)) + 2)},{ass_time(start_ms)},{ass_time(end_ms)},Title,,0,0,0,,{override}{text}\n"
        )
    path.write_text("".join(lines), encoding="utf-8")
