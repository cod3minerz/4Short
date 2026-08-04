# ADR: HVE preview and rendering stack

- Status: accepted for HVE v2
- Decision owners: Sol architecture; Terra implementation
- Hardware target: Timeweb CPU worker, 8 vCPU / 12 GB RAM

## Context

HVE needs an immediate browser editor and deterministic production rendering for crop tracking, 1–4 speakers, screen share, gameplay, captions, title, banner, logo, B-roll, pause removal and audio normalization. Preview and final output must agree while several users share a small CPU worker.

## Options considered

| Option | Preview | Final render | Result |
|---|---|---|---|
| Remotion everywhere | React/Player | Chromium renderer | rejected as default |
| ffmpeg.wasm | browser canvas/WASM | browser WASM | rejected |
| universal open-source NLE | library-specific | mixed | reference only |
| custom preview + native FFmpeg | native video/canvas/DOM | FFmpeg/libass | accepted |

### Remotion

Advantages: React composition model, embedded Player, parameterized compositions and an ecosystem for motion templates.

Costs: server rendering involves a browser/frame pipeline, additional RAM and CPU, licensing considerations for commercial/editor products, and a separate visual semantics from FFmpeg. It does not remove the need for project storage, autosave, media ingestion, caption timing, model inference or HVE layout planning.

### ffmpeg.wasm

Advantages: familiar FFmpeg-like API in a browser.

Costs: slower than native FFmpeg, heavy downloads/memory, tab-lifetime dependency and unsuitable behavior for production batch rendering. It is unnecessary for preview-only geometry.

### General NLE codebases

Advantages: reusable drag/resize/snapping patterns.

Costs: arbitrary track/item models, broader feature surface and evolving render implementations. HVE would inherit complexity unrelated to its production workflow.

## Decision

Use one `ClipDocumentV2` and one resolved plan:

```text
ClipDocumentV2 -> HVE planner -> ResolvedRenderPlan
                                  |              |
                       browser preview     FFmpeg/libass
```

Browser:

- proxy `<video>` as clock and decoder;
- DOM/SVG for captions and production layers;
- Canvas2D/WebGL2 for multi-slot composition;
- optional WebCodecs worker for frame-accurate enhancement;
- native-video fallback on every supported browser.

Server:

- native FFmpeg and libass;
- generalized slot compositor;
- bounded CPU threads and independent clip jobs;
- deterministic artifact hash and post-render verifier.

Remotion is allowed only behind a future adapter for pre-rendered complex motion layers after license, memory, parity and performance gates. It cannot become a transitive requirement of the standard render path without superseding this ADR with measured evidence.

## Consequences

Positive:

- lower steady-state memory on the worker;
- no Chromium in normal renders;
- native codec and A/V handling;
- predictable cache/retry boundaries;
- one domain document and plan;
- editor complexity stays bounded.

Costs:

- HVE must build its own preview compiler and slot compositor;
- layout and text metrics require careful cross-runtime parity tests;
- motion templates are constrained until an adapter exists.

## Reconsideration criteria

Reconsider only if a candidate demonstrates on the real worker and golden corpus:

- equal or lower peak RSS;
- equal or better p95 realtime factor;
- no loss of A/V correctness or render determinism;
- preview geometry parity;
- acceptable commercial licensing;
- operational recovery at least as strong as native FFmpeg.
