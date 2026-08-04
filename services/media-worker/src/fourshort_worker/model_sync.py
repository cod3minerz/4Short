"""Explicit provisioning command for an immutable local Whisper model pack.

Run this during deployment, before the worker service is started. It is not a
runtime fallback: a failed or interrupted download leaves the existing pack
untouched and the worker will report STT as unavailable instead of silently
changing models during a job.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile

from huggingface_hub import snapshot_download

from .model_assets import write_model_manifest


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Provision a pinned local Faster-Whisper model pack")
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--source", default="Systran/faster-whisper-large-v3-turbo")
    parser.add_argument("--revision", required=True, help="Immutable Hugging Face commit SHA, not a branch name")
    parser.add_argument("--destination", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = _args()
    if len(args.revision) < 12 or args.revision.lower() in {"main", "master"}:
        raise SystemExit("--revision must be an immutable Hugging Face commit SHA")
    destination = args.destination.resolve()
    if destination.exists():
        raise SystemExit(f"Refusing to overwrite existing model pack: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_root = Path(tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent))
    staged = temporary_root / "model"
    try:
        snapshot_download(
            repo_id=args.source,
            revision=args.revision,
            local_dir=staged,
            local_dir_use_symlinks=False,
        )
        # Hugging Face keeps transport metadata here; it is not part of the
        # CTranslate2 artifact and must not make the manifest platform-specific.
        shutil.rmtree(staged / ".cache", ignore_errors=True)
        fingerprint = write_model_manifest(staged, model=args.model, source=args.source, revision=args.revision)
        os.replace(staged, destination)
        print(f"STT_MODEL_FINGERPRINT={fingerprint}")
        print(f"STT_MODEL_PATH={destination}")
    except Exception:
        shutil.rmtree(staged, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)


if __name__ == "__main__":
    main()
