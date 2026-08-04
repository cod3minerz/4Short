"""Stable, non-secret identity for one HVE worker runtime.

Completed job timing can only calibrate ETA for the same effective runtime.
The identity therefore binds immutable engine/model/font settings and cgroup
limits, but deliberately excludes hostnames, S3 credentials and customer
media.  It is sent with worker registration and every successful job metric.
"""

from __future__ import annotations

from hashlib import sha256
import json
from typing import Any, Mapping


RUNTIME_IDENTITY_SCHEMA_VERSION = 1


def canonical_runtime_identity(payload: Mapping[str, Any]) -> str:
    """Serialize a runtime descriptor deterministically before hashing it."""
    return json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def runtime_fingerprint(payload: Mapping[str, Any]) -> str:
    """Return the SHA-256 identity used to scope HVE timing observations."""
    return sha256(canonical_runtime_identity(payload).encode("utf-8")).hexdigest()
