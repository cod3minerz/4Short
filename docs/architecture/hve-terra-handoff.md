# Terra handoff — start here

## Objective

Implement HVE v2 as a compatible production path beside v1. Do not rewrite the existing control plane and do not start by adding UI controls or new FFmpeg layout branches.

## Required reading order

1. `AGENTS.md`
2. `.claude/skills/hve-production/SKILL.md`
3. `hve-production-architecture.md`
4. `hve-contracts.md`
5. `adr-hve-rendering-stack.md`
6. `hve-editor-architecture.md`
7. `hve-verification.md`
8. `hve-implementation-roadmap.md`

## Repository reality

Keep:

- PostgreSQL workspaces, minute ledger and immutable transactions;
- S3 upload/source/artifact flow;
- lease/heartbeat/retry queue;
- Faster-Whisper, LLM moment search and ASS/FFmpeg foundations;
- independent clip jobs and current v1 compatibility.

Treat as prototype and replace through v2:

- one-layout `ClipEDL`;
- layout-specific renderer conditionals;
- greedy face tracking and “largest face = speaker” behavior;
- CSS-only preview that does not consume the renderer plan;
- localStorage-only draft;
- monolithic `clip-editor.tsx`;
- validation limited to dimensions/audio/duration/size.

## First task

Implement roadmap HVE-0 and HVE-1 only:

```text
1. shared v2 contracts + canonical hashing
2. v1 import adapter + roundtrip fixtures
3. manifest/draft/engine DB migrations
4. HVE service boundaries in control API
5. worker resource metrics + actual FFmpeg smoke test
6. warnings/LockedField for capabilities renderer does not execute
7. minimum scheduler safety: `cpu_medium`, capability/model matching, memory/scratch admission and per-workspace limits
8. baseline report on the 8 CPU / 12 GB worker
```

Do not implement Light-ASD, 3/4-person layouts, Remotion or the new editor before these gates pass. After HVE-1, execute the roadmap in order: time-map/captions/audio, compositor/layers/shared preview, editor, then perception/director.

## Architectural invariants

- `ClipDocumentV2` is mutable only as a server draft; `ClipVersionV2` is immutable.
- `ResolvedRenderPlan` is the only geometry/timing input for preview and final render.
- The planner decides; the renderer executes.
- Dense frame data belongs in S3, not PostgreSQL.
- Every fallback has a code, reason, applied result and user-visible warning.
- Every stage is idempotent and cached by all relevant versions/hashes.
- Mutable drafts never enter the render queue.
- A clip render failure never blocks sibling clips.

## Evidence required in each PR

Use the template in `hve-implementation-roadmap.md`. If the required verification gate does not yet exist, implement it in the same slice or mark the capability unverified/locked. Never substitute a code walkthrough for media evidence.

## Current worktree warning

At the time of this handoff the repository already contains uncommitted HVE v1 work in contracts, control API and media-worker files, including new `vision.py` and tests. Inspect `git status` first and preserve that work. The architecture documents and skills intentionally do not overwrite those implementation changes.
