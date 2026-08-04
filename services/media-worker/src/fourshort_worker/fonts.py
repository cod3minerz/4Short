from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess

from .errors import JobError


FONT_PLAN_ID = "hve-sans-v1"
FONT_PACK_VERSION = "hve-font-pack-dejavu-2.37-1"
RENDERER_FAMILY = "DejaVu Sans"


def installed_font_pack() -> dict[str, str | bool]:
    """Read the real font selected by fontconfig, never a guessed fallback.

    The Docker image installs fonts-dejavu-core.  A small runtime probe keeps
    a bad image or missing fontconfig from becoming a visually different
    render while still allowing non-render worker jobs to run.
    """
    try:
        result = subprocess.run(
            ["fc-match", "--format=%{family}\\n%{file}\\n", RENDERER_FAMILY],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return {"available": False, "id": FONT_PLAN_ID, "packVersion": FONT_PACK_VERSION}
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if result.returncode != 0 or len(lines) < 2 or lines[0] != RENDERER_FAMILY:
        return {"available": False, "id": FONT_PLAN_ID, "packVersion": FONT_PACK_VERSION}
    path = Path(lines[1])
    if not path.is_file():
        return {"available": False, "id": FONT_PLAN_ID, "packVersion": FONT_PACK_VERSION}
    return {
        "available": True,
        "id": FONT_PLAN_ID,
        "packVersion": FONT_PACK_VERSION,
        "rendererFamily": RENDERER_FAMILY,
        "fileSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def apply_resolved_font_plan(config: dict, font_plan: object) -> dict:
    """Return an ASS config bound to the immutable queued font plan.

    Final rendering must use this function rather than `fontFamily` directly
    from an EDL.  That field is editor input, while the plan is approved by
    the control plane and validated against the actual worker image here.
    """
    if not isinstance(font_plan, dict):
        raise JobError("HVE_FONT_PLAN_MISSING", "Render job has no resolved font plan", retryable=False)
    if (
        font_plan.get("id") != FONT_PLAN_ID
        or font_plan.get("packVersion") != FONT_PACK_VERSION
        or font_plan.get("rendererFamily") != RENDERER_FAMILY
    ):
        raise JobError("HVE_FONT_PLAN_INVALID", "Render job requests an unsupported font pack", retryable=False)
    installed = installed_font_pack()
    if not installed.get("available"):
        raise JobError("HVE_FONT_PACK_UNAVAILABLE", "The verified subtitle font pack is missing on this worker", retryable=False)
    resolved = dict(config)
    resolved["fontFamily"] = RENDERER_FAMILY
    return resolved
