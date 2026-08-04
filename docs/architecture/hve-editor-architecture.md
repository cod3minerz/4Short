# HVE clip editor — production architecture

## 1. Editor promise

The editor must let a user correct an automatically generated clip immediately without becoming a browser clone of Premiere or CapCut. It combines transcript-first editing with a bounded segment timeline and a live 9:16 composition.

Reference baseline: OpusClip supports text/timeline editing, per-segment layout changes, manual reframing, caption correction, overlays and trim. Its documented layouts include Fill, Fit, Split, Three, Four, Screenshare and Gameplay, where Gameplay allocates roughly 30% to the speaker and 70% to gameplay. HVE must match these useful capabilities while adding bulk scopes, server drafts, deterministic parity and visible fallbacks. See [Opus layout and reframing](https://help.opus.pro/docs/article/layout-and-reframing), [caption editing](https://help.opus.pro/docs/article/change-captions) and [text overlays](https://help.opus.pro/docs/article/add-text-overlays).

## 2. Information architecture

Desktop:

```text
48px command bar
┌──────────────┬──────────────────────────┬──────────────────┐
│ Transcript   │  Canvas / 9:16 preview  │ Properties       │
│ 240–320 px   │  flexible, >= 600 px    │ 288–360 px       │
├──────────────┴──────────────────────────┴──────────────────┤
│ transport + bounded segment/layout/layer strip            │
└────────────────────────────────────────────────────────────┘
```

The right panel has stable navigation and placement, but its properties are selection-driven: a slot shows crop/layout/speaker, captions show caption properties, a banner shows banner properties, and an empty selection shows clip/export settings. Do not restore eight always-open Accordion groups.

The lower strip contains bounded lanes:

1. narrative segments: trim, split, delete, reorder, extend;
2. layout segments: auto/solo/split/grid/screen/gameplay/manual;
3. captions;
4. fixed production layers: title, banner, logo, B-roll, outro, music.

This is not an arbitrary multi-track timeline. Users cannot create unknown track types or insert raw filters.

## 3. Core interactions

### Transcript

- word-level seek and selection;
- edit display text without changing sound;
- hide selected words from captions;
- remove selected words with audio/video using the time map;
- set clip start/end from selection;
- add a source section before or after the current narrative;
- search, speaker labels and dictionary corrections;
- undo/redo across text and visual changes.

### Canvas

- play/pause, frame step and direct seek;
- manual crop by dragging a source region inside its slot;
- select caption, title, banner, logo or slot;
- safe-zone, face-box and crop-track debugging overlays;
- zoom modes: fit, 50%, 75%, 100%;
- warnings displayed at their time range.

### Segment strip

- snapping to word, shot, layout boundary, layer edge and playhead;
- per-segment layout selection;
- layout changes apply immediately to preview plan;
- reorder only narrative segments, not arbitrary media frames;
- minimum segment durations and overlap rules enforced by contracts.

### Apply scope

Actions with meaningful scope offer:

- current segment;
- current clip;
- selected clips;
- project;
- update existing style;
- save as new style.

The scope menu is not opened for every edit. The default remains the current clip/segment.

## 4. State modules

Split the existing monolithic `clip-editor.tsx`:

```text
app/dashboard/editor/
  model/         document, selection, derived state
  commands/      typed commands and reducers
  history/       undo/redo and command compaction
  player/        clock, seek, capability adapter
  preview/       plan compiler and renderers
  transcript/    virtualized words and text operations
  timeline/      bounded lanes, snapping, trim/reorder
  canvas/        slots, layers, handles, debug overlays
  inspector/     stable property groups
  drafts/        autosave, offline queue, conflicts
  render/        commit, render status and artifact refresh
```

Use a single reducer/store for document commands and a separate ephemeral store for selection, hover, panel sizes, zoom and playback. Do not put playback ticks into React global state; subscribe at the canvas boundary.

## 5. Preview stack

### Standard path

- Browser receives a 540p or 720p H.264/AAC proxy with HTTP Range.
- A `CompositionClock` in output microseconds is authoritative. A `SequencePlayer` maps it through `TimeMap` to the active source/proxy decoder and seeks/preloads at narrative discontinuities.
- `requestVideoFrameCallback` schedules visual updates.
- One-source crop uses transform/clip.
- Split/grid/gameplay draws the same decoded frame into multiple slots with Canvas2D initially and WebGL2 when profiling justifies it.
- Captions and production layers use DOM/SVG, driven by resolved pixel geometry.
- Waveform, thumbnails and contact sheet are precomputed by the worker.

The original source is never downloaded in full. The preview can downgrade quality while preserving geometry.

`SequencePlayer` owns a bounded decoder pool: one primary proxy plus at most two secondary video decoders for B-roll, outro or a second source on desktop; mobile allows one secondary decoder. It preloads the next narrative segment, schedules a short discontinuity/crossfade according to the plan, falls back to a poster under decoder pressure and releases inactive frames/decoders. Audio follows composition time, not a raw media element clock.

Standard frame-step is guaranteed only on a CFR editor proxy with a short GOP and frame index. If that proxy is unavailable, the UI labels precise frame-step as enhanced-only instead of pretending native seek is exact.

### Enhanced path

WebCodecs is optional for accurate frame stepping, thumbnail extraction and future high-performance compositing in a Dedicated Worker. It offers low-level, hardware-accelerated frame access, but does not provide muxing/demuxing and requires explicit `VideoFrame.close()` memory management. See [MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) and [usage guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API).

Capability modes:

- `enhanced`: Chrome/Edge with supported codec, WebCodecs worker and optional Mediabunny parser;
- `standard`: Safari/Firefox/native video with prepared thumbnails;
- `mobile`: native video, lower proxy resolution, sheets instead of simultaneous side panels.

A capability downgrade never loses draft changes.

## 6. Preview/render parity

Both clients consume `ResolvedRenderPlan`. The planner owns:

- line breaks and caption groups;
- target rectangles and crop keyframes;
- time mapping;
- safe-zone collision results;
- transition boundaries;
- font and asset metrics.

The browser maps the plan to DOM/SVG/canvas; the server maps it to FFmpeg/libass. Neither is allowed to choose a different line break, slot ratio or fallback. Exact pixel antialiasing can differ, but geometry and timing must pass the parity gate.

Text contract:

- every font asset is referenced and cached by SHA-256; missing font is a blocking plan warning, never a silent fallback;
- planner emits explicit caption lines, baseline, anchor, line height, bounding box and output ranges;
- ASS contains planner-provided `\N` line breaks and positions;
- browser loads the identical font file and renders the same planned lines;
- visual comparison masks antialiasing edges but requires matching geometry and clipping.

## 7. Draft/autosave protocol

Every user action is a typed `EditorCommand`. The client applies it optimistically, appends it to local history and sends debounced batches.

```text
local command -> reducer -> preview plan
              -> PATCH draft with base revision
              <- normalized draft / conflict
```

Rules:

- debounce ordinary changes at 400–800 ms;
- flush on blur, navigation, manual save and visibility change;
- store a bounded offline queue in IndexedDB, not only localStorage;
- periodically snapshot the document to bound command replay;
- server revision is monotonic;
- two-tab conflict never silently overwrites newer work;
- the user can reload server version or create a copy when automatic rebase is unsafe.

`Cmd/Ctrl+S` flushes draft. “Обновить клип” atomically records an immutable version plus render intent; planning and rendering then run outside the database transaction and only for that clip. A failed commit prevents plan/render events; errors must propagate.

Editor bootstrap uses `GET /v1/clips/:clipId/editor-manifest` from `hve-contracts.md`. Signed proxy URLs expose expiry and refresh; the player refreshes before expiry and retries once after a 403 without discarding the draft. Proxy responses must support Range requests, CORS, correct MIME and private cache policy.

## 8. Command and scope matrix

Every visible operation must map end-to-end:

| Feature | Command | Document area | Preview | Final compiler | Primary scope |
|---|---|---|---|---|---|
| Replace caption word | `replace_word` | captions.words | DOM/SVG | caption plan/ASS | clip/project bulk |
| Hide/cut words | `set_word_visibility` / `cut_words` | captions/audio/narrative | SequencePlayer | time map + audio/video | selection |
| Trim/split/reorder/extend | narrative commands | narrative | SequencePlayer | concat/time map | clip |
| Layout per segment | `set_layout` | layout | slot compositor | FFmpeg slots | segment/clip/project |
| Manual crop | `set_manual_crop` | slot override | canvas | crop keyframes | segment |
| Subtitle style/position | `set_caption_style` | captions.style | DOM/SVG | ASS | clip/project/style |
| Title/banner/logo/outro | layer commands | layers | DOM/video decoder | overlay graph | clip/project/style |
| B-roll replace/delete/timing | layer commands | layers | secondary decoder | overlay/replace graph | item/clip |
| Music trim/volume/ducking | audio policy | audio | Web Audio/native mix | audio graph | clip/project/style |

Snapping, frame/segment navigation and source transcript picker are editor behaviors around these commands, not additional persisted track types. A feature is unlocked only after command, document patch, preview adapter, final compiler and fixture all exist.

## 9. Why Remotion is not the core

Remotion Player is useful for React compositions, while its server renderer uses a browser/frame-render pipeline. On the current CPU worker, Chromium competes with FFmpeg, STT and vision for RAM and creates a second semantic implementation of rendering. Remotion’s Editor Starter and Timeline are also licensed, general-purpose products rather than a finished HVE editor. See [Remotion Player](https://www.remotion.dev/docs/player), [renderer](https://www.remotion.dev/docs/renderer), [performance](https://www.remotion.dev/docs/performance), [Editor Starter](https://www.remotion.dev/docs/editor-starter) and [license](https://www.remotion.dev/docs/license).

Decision:

- no Remotion Player for the standard preview;
- no Remotion/Chromium for standard final renders;
- no ffmpeg.wasm for final renders because native FFmpeg is substantially faster and more reliable;
- optional future `RemotionOverlayAdapter` may pre-render a licensed complex motion template to alpha media, then hand it back to FFmpeg.

OpenCut and general timeline libraries are architectural references only; their universal NLE data models must not become the HVE domain model.

## 10. Performance budgets

Initial budgets use a versioned benchmark manifest defining browser, OS, CPU/RAM, proxy codec/GOP, clip duration and layout complexity. Required profiles include a 4-core/8 GB desktop Chrome, current iPhone Safari, a low/mid Android Chrome and desktop Firefox/Safari standard paths.

Budgets with prepared proxy:

- editor metadata and first interactive preview: p95 <= 2 s;
- local edit response: p95 < 50 ms;
- scrub response: p95 <= 150 ms;
- no main-thread task > 50 ms during ordinary editing;
- canvas playback: 30 FPS minimum on target desktop;
- desktop memory target <= 500 MB;
- mobile memory target <= 250 MB;
- 1,000 transcript/timeline items are virtualized;
- no full-source download;
- opening three editor tabs must not crash, although only the visible tab actively composites.

Preload only adjacent thumbnails and current proxy ranges. Suspend rendering and animation for background tabs.

## 11. Mobile editor

- hide dashboard shell and bottom navigation;
- top bar contains back, clip name, draft status and update action;
- preview occupies the primary viewport;
- bottom modes: Text, Segments, Properties;
- modes open as half/full sheets and preserve canvas position;
- no client export and no simultaneous three-panel layout;
- touch targets >= 44 px even though desktop controls stay compact.

## 12. Delivery gates

The editor cannot be called production-ready until:

- server draft survives reload and offline recovery;
- undo/redo restores canonical document equivalence;
- failed draft commit cannot trigger stale render;
- transcript cuts update A/V, captions and layers through one time map;
- per-segment layout and manual crop render correctly;
- browser/FFmpeg parity passes representative golden frames;
- Safari/Firefox standard mode and Chrome enhanced mode preserve functionality;
- mobile sheets support every essential correction;
- no visible control maps to an unimplemented engine feature.
