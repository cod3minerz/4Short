from __future__ import annotations

from pathlib import Path


def ass_time(milliseconds: int) -> str:
    total_centiseconds = max(milliseconds, 0) // 10
    hours, remainder = divmod(total_centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def ass_color(hex_color: str, alpha: str = "00") -> str:
    value = hex_color.lstrip("#")
    red, green, blue = value[0:2], value[2:4], value[4:6]
    return f"&H{alpha}{blue}{green}{red}&"


def escape_ass(value: str) -> str:
    return value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def write_ass(path: Path, cues: list[dict], config: dict, width: int, height: int) -> None:
    font_size = int(config.get("fontSize", 58))
    margin_v = int(config.get("safeMarginPx", 160))
    alignment = {"top": 8, "center": 5, "bottom": 2}.get(config.get("position"), 2)
    primary = ass_color(config.get("color", "#ffffff"))
    outline = ass_color(config.get("outlineColor", "#06131a"))
    active = ass_color(config.get("activeColor", "#10b8f4"))
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,{config.get("fontFamily", "Manrope")},{font_size},{primary},{active},{outline},&H66000000&,-1,0,0,0,100,100,0,0,1,{config.get("outlinePx", 4)},2,{alignment},60,60,{margin_v},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    lines = [header]
    for cue in cues:
        text = escape_ass(str(cue["text"]))
        if config.get("uppercase"):
            text = text.upper()
        lines.append(
            f"Dialogue: 0,{ass_time(int(cue['startMs']))},{ass_time(int(cue['endMs']))},Default,,0,0,0,,{text}\n"
        )
    path.write_text("".join(lines), encoding="utf-8")
