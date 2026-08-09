# Phase 7.4 — Clip Editor and overlays audit

Date: 2026-08-10
Scope: `/dashboard/projects/[id]/clips/[clipId]` and only the shared code that
this editor requires (`layout-options`, `AppIcon` consumers and retired
editor-only Hashpix helpers). Phase 7.5 is not started.

## No-touch boundary

The migration does not change `ClipEDL`, HVE draft/document commands, render
or control APIs, optimistic revision handling, media manifest, preview clock,
seek/playback synchronisation, crop/layout coordinates, video transforms,
timeline calculations, `RangeTimeline`, `HveCompositionPreview` or
`SubtitlePreviewOverlay` positioning. The only ordinary range input converted
is the settings-only canvas zoom control; the specialised trim timeline stays
`RangeTimeline`.

## Targeted audit and result

| Surface | Before | Classification | Result |
| --- | --- | --- | --- |
| Header, undo/redo, apply and rerender | legacy `ActionButton` tone API / Lucide | REPLACE WITH SHARED COMPOSITION | `AsyncButton`, named `IconButton`, `AppIcon` and registry `Input` |
| Transcript search and word correction | local input paint | REPLACE WITH PRIMITIVE | registry `Field`/`Input`; word chips remain a specialised transcript-selection surface |
| Inspector settings | Choice helpers, local fields, native ranges | REPLACE WITH PRIMITIVE | `Field`, `Input`, `Textarea`, `Select`, `Switch`, `Slider` and `ToggleGroup` |
| Save scope modal | `SelectableRow` choices | REPLACE WITH PRIMITIVE | registry `Dialog` and vertical `ToggleGroup` choice rows |
| Subtitle colours | custom `ColorField` | LEGITIMATE EXCEPTION | native colour picker wrapped by registry `Field`; colour input has no Vega replacement |
| Preview/timeline | canvas, video, overlays and trim handles | KEEP AS EDITOR/GEOMETRY INFRASTRUCTURE | unchanged source/mechanics; only adjacent play/zoom controls use canonical buttons/Slider |
| Subtitle sample picker | domain subtitle preview catalogue | KEEP AS SHARED COMPOSITION | `SampleList`, now using `AppIcon`/Hugeicons |
| Layout option icons | Lucide data source | REPLACE WITH SHARED COMPOSITION | Hugeicons icon data rendered through `AppIcon` |
| `ChoiceSelect`, `ChoiceSwitch`, `ColorField`, `OptionCard`, `SelectableRow` | editor-only legacy helpers | REMOVE AS LEGACY VISUAL CODE | deleted after zero-consumer scan |

## Replaced primitives

- `Button`, `Input`, `Textarea`, `Select`, `Switch`, `Slider`, `Tabs`,
  `ToggleGroup`, `Card`, `Dialog` and registry `Field` anatomy.
- Phase 5 `AsyncButton`, `IconButton` and `AppIcon`; all Clip Editor standard
  icons use Hugeicons.

## CSS classification

- **Removed:** generic local Button/Input/field/choice-card paint, focus,
  radius, colour and toolbar/mobile-tab overrides; the now-dead editor helper
  CSS is removed with its last consumer.
- **Kept:** preview and safe-zone positioning, media overlays, trim/timeline
  geometry, panel/grid structure, transcript word-selection mechanics and
  compact timecode (`9px`) semantics. These are editor/media geometry rather
  than replacement primitive recipes.
- **Scoped exceptions:** colour-picker swatches, multiline scope choices and
  responsive grid placement only. They do not redefine canonical primitive
  height, radius, typography, focus or palette.

## HVE impact and evidence

- HVE/ClipEDL/render/media source and contracts: no diff.
- `npm run hve:smoke:g4`: PASS.
- HVE-G3 is not run: no preview/render/media/timeline coordinate or geometry
  implementation changed. This is a conditional non-applicability, not a
  claimed G3 pass.

## Browser evidence

The local route initially resolved to its populated preview state, but the
browser session then expired and redirected to `/sign-in`. The documented
development credential `test@hashpix.local` / `test` is rejected by the live
Better Auth server. Consequently, the available authenticated-editor browser
matrix (loading/error/ready, toolbar, inspector, dialogs, preview/timeline,
console and 360/768/1024/1440) is **blocked**; no static result is presented
as browser PASS. The initial accessible populated DOM had no horizontal
overflow at 1280px before the redirect. A valid local test-admin session and
fixture are required to close this evidence debt.

## Design-system leak result

- No Clip Editor `lucide-react`, legacy helper import, `--hp-*`, `--dash-*`,
  raw ordinary button/select/textarea or native range remains.
- The two native `input[type=color]` controls are the documented legitimate
  media-style exception.
- `RangeTimeline`, canvas/video, preview overlays and transcript word chips
  are specialised editor surfaces, not unresolved primitive leaks.
- `components/ui` is not modified in this phase and remains registry-owned.
