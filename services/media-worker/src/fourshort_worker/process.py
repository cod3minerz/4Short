from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
from typing import Iterable

from .errors import JobError


def run_command(
    args: Iterable[str],
    *,
    timeout_seconds: int,
    cwd: Path | None = None,
    capture_json: bool = False,
) -> str | dict:
    command = [str(value) for value in args]
    if not command or any("\x00" in value for value in command):
        raise JobError("INVALID_COMMAND", "Invalid subprocess arguments", retryable=False)
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env={**os.environ, "LC_ALL": "C.UTF-8"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            timeout=timeout_seconds,
            shell=False,
        )
    except subprocess.TimeoutExpired as error:
        raise JobError(
            "PROCESS_TIMEOUT",
            f"Process exceeded {timeout_seconds} seconds",
            retryable=True,
            details={"binary": command[0]},
        ) from error
    if completed.returncode != 0:
        raise JobError(
            "PROCESS_FAILED",
            f"{Path(command[0]).name} failed",
            retryable=completed.returncode in {137, 143, 255},
            details={"returnCode": completed.returncode, "stderr": completed.stderr[-2000:]},
        )
    if capture_json:
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise JobError("INVALID_PROCESS_OUTPUT", "Process returned invalid JSON", retryable=False) from error
    return completed.stdout
