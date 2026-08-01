---
name: clip-formats
description: Reference for the 9 ClipLayout / vertical-crop format variants in the 4Short wizard and editor — what each means, its composition, its ClipLayout string, and whether the worker actually renders it yet. Use when building the format picker (wizard step 2) or the editor's frame/layout section. Keywords: format, layout, ClipLayout, crop, blur background, active speaker, podcast, screen speaker, picture in picture.
---

# Clip formats (vertical-crop layouts)

Single source of truth for labels/icons/hints: `app/dashboard/lib/layout-options.ts`. Don't duplicate this list anywhere else — import from there.

| `ClipLayout` value | Meaning | Composition | Renders today? |
|---|---|---|---|
| `auto` | Pick automatically | Plain centre crop (no x/y/zoom applied) | **Yes** |
| `solo` (picker shows only this now — see below) | Fixed crop at a chosen position/zoom | Real x/y/zoom-aware ffmpeg crop — `x`/`y` (0–1, clamped) position the crop window along the scaled frame's slack, `zoom` (≥1) scales the fill target up before cropping | **Yes** (Phase F4) |
| `blur` | Full source, blurred fill | Source scaled to fit height, blurred/scaled copy fills the sides | **Yes** |
| `active_speaker` | Follow whoever's talking | Crop window tracks the active speaker | No — needs `face_track`, currently `FACE_MODEL_NOT_INSTALLED` |
| `podcast` / `panel` | Two speakers stacked | Split vertical: one speaker top, one bottom (or side by side) | No — ffmpeg ignores the params; both map to the same `two_speakers` payload |
| `screen_speaker` | Screen + facecam | Facecam pinned to one edge (`facePosition`), screen fills the rest | No |
| `picture_in_picture` | Inset webcam over main feed | Small inset panel (`inset: top_right` etc.) over the main crop | No |

Format picker in the wizard must only present the "Renders today" rows as selectable; everything else is a `LockedField` (see `no-dead-ui`). Update this table's "Renders today?" column in the same change that implements a new ffmpeg branch in `render.py` — the fallback (`else`) branch in `compile_video_filter` is the plain centre-crop every not-yet-implemented mode still gets, so nothing breaks by staying unimplemented, it just doesn't do anything mode-specific.

`static_crop`'s x/y/zoom were previously silently ignored — the crop was always dead-centre regardless of what was sent (harmless since nothing sends non-default values yet, but real if a future feature needs off-centre framing). Tests: `services/media-worker/tests/test_render.py`.

The picker used to offer `solo` AND `static_crop` as two separate cards with different hint text, but `layoutToApi` (`app/dashboard/lib/layout-options.ts`) has always sent the identical `{mode:"static_crop", x:0.5, y:0.5, zoom:1}` for both — two labels promising different behavior, zero actual difference (E-AUDIT pass, confirmed live). Removed the `static_crop` picker entry, kept `solo`. The `ClipLayout` TS union still has both string values (old saved data may use either) and `layoutToApi` still maps both — only the picker card was removed. If x/y/zoom customization ever gets real UI (a drag-to-position crop tool), that's the moment to reintroduce a second, genuinely different card — not before.

`podcast` and `panel` currently collapse to the identical API payload (`layoutToApi` in `layout-options.ts`) — if Phase F4 gives them genuinely different renders, split the mapping too, don't leave two UI labels pointing at one behaviour.
