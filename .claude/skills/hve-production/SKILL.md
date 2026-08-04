---
name: hve-production
description: Use for any Hashpix Video Engine, media-worker, clip editor, ClipEDL, layout, face/speaker tracking, subtitle, render, queue, benchmark, or media verification change. Enforces the production HVE v2 architecture, preview/render parity, resource limits, and evidence-based release gates.
---

# HVE Production

Implement HVE as a deterministic media system, not a collection of UI toggles or FFmpeg conditionals. The canonical clip document, analysis artifacts, layout plan, browser preview, and final renderer must remain compatible.

## Read first

Read only the documents relevant to the change, but always read the first two:

1. `docs/architecture/hve-production-architecture.md`
2. `docs/architecture/hve-contracts.md`
3. Editor work: `docs/architecture/hve-editor-architecture.md`
4. Render stack decisions: `docs/architecture/adr-hve-rendering-stack.md`
5. Model/library changes: `docs/architecture/hve-component-evaluation.md`
6. Tests or release work: `docs/architecture/hve-verification.md`
7. Iteration scope: `docs/architecture/hve-implementation-roadmap.md`

Also inspect `.claude/skills/backend-capability-map/SKILL.md`. It is a published-state snapshot, not an oracle: when current code and executable tests disagree with it, verify the code path and update the map in the same change. For UI work, use the dashboard design, UX, no-dead-UI, CSS regression, subtitle, and clip-format skills when applicable.

## Workflow

1. Inspect `git status`; preserve unrelated and unfinished user changes.
2. Name the roadmap slice and acceptance gate being implemented.
3. Update shared contracts before control API, worker, or editor code.
4. Keep HVE v1 readable while adding v2 through explicit adapters and migrations.
5. Store dense frame analysis in S3 artifacts; PostgreSQL stores manifests, hashes, versions, and status.
6. Make every stage idempotent and independently retryable. Include input hashes, schema, engine, model, and planner versions in cache keys.
7. Compile the same normalized layout plan into browser preview geometry and FFmpeg render geometry.
8. Add fixtures and failure-path tests in the same change. Do not defer verification to a later phase.
9. Run the smallest relevant checks, then the full gate required by the roadmap slice.
10. Update capability documentation only to what is proven by tests or benchmark evidence.

## Non-negotiable constraints

- `ClipDocumentV2` is the editable source of truth; immutable `ClipVersionV2` is the only render input.
- Use integer microseconds and rational frame time. Do not persist editing time as floating-point seconds.
- The renderer consumes a resolved plan. It must not run ML models or make editorial decisions.
- Do not add another layout-specific branch when the behavior belongs in the slot compositor.
- Do not persist raw frames or per-frame rows in PostgreSQL.
- Do not use Remotion, Chromium, or ffmpeg.wasm as the standard production renderer.
- WebCodecs is an optional browser enhancement with a native-video fallback, never a hard requirement.
- Do not claim active-speaker tracking without an audio-to-speaker-to-face mapping and a tested fallback.
- Do not expose a control before the engine implements it. Use `LockedField` for intentionally unavailable functions.
- A renderer warning must be visible to the user when a requested layout falls back.
- Mutable drafts never enter the render queue directly.
- One failed clip must not block the rest of a project.

## Resource budgets

Treat the current media worker as `8 vCPU / 12 GB RAM / 100 GB NVMe`:

- one heavy job of any kind by default; do not overlap STT, dense vision and 1080p encode merely because their process names differ;
- one light probe or analysis slot only when memory admission permits;
- provider-waiting jobs consume no local CPU slot;
- reject new heavy work below a hard 12 GB scratch-free floor and begin admission throttling below 20 GB;
- stream source and artifacts where possible;
- measure peak RSS, CPU seconds, I/O bytes, and realtime factor for every heavy stage.

Do not increase concurrency from intuition. Change slot policy only after the benchmark gate in `hve-verification.md` passes.

## Completion evidence

Before declaring a slice finished, report:

- contracts and migrations changed;
- exact stages and fallbacks implemented;
- fixtures exercised;
- semantic and visual checks passed;
- peak RSS and realtime factor for media changes;
- browser matrix for editor changes;
- known unsupported cases still surfaced as locked or warned states.

“Code exists” is not production evidence. A feature is ready only when the corresponding roadmap gate passes.
