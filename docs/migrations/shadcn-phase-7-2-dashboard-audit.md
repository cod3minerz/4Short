# Phase 7.2 — dashboard, source flow and projects audit

Date: 2026-08-09
Branch: `codex/shadcn-ui-migration`
Foundation: `b37sSWfzM` / Vega / Hugeicons / Geist

## Scope guard

This wave migrates the dashboard shell, `/dashboard` source flow and
`/dashboard/projects` to canonical primitives. It does **not** redesign the
Hashpix dashboard. The original shell DOM boundaries, navigation grouping,
topbar locations, sidebar/mobile-navigation behaviour, source-wizard frame,
footer and project-list information architecture are retained.

The registry `Sidebar` was evaluated but is intentionally not mounted: making
it the shell foundation would replace the established product composition and
require a provider/root behavioural change. Its installation remains useful for
a later consumer that can preserve the existing composition. This is a
`KEEP AS PRODUCT/STRUCTURAL GEOMETRY` decision, not a parallel sidebar
primitive.

The earlier Phase 7.2 experiment that used a demo-style registry Sidebar and a
grid-card projects layout was removed before this record. No recovery wizard
diff was replayed. The only intentional structural exception is removal of the
old processing-screen viewport centring/min-height constraint: it prevents an
invented empty lower area and does not change processing state, navigation or
the source workflow.

## Targeted before/after classification

| Surface | Before | Decision and applied implementation |
| --- | --- | --- |
| Topbar balance/profile | custom balance and `<details>`-style profile paint | **REPLACE WITH PRIMITIVE:** registry `Button` and `DropdownMenu`, `StatusBadge`, `AppIcon`/Hugeicons. Existing position and actions retained. |
| Sidebar + mobile navigation | product navigation and responsive geometry | **KEEP AS PRODUCT/STRUCTURAL GEOMETRY:** existing `dash-*` layout classes and route grouping remain; link icons are `AppIcon`/Hugeicons. No `Sidebar` demo layout is introduced. |
| Source wizard frame/body/footer | product workflow frame, step order, sticky action behaviour | **KEEP AS PRODUCT/STRUCTURAL GEOMETRY:** existing `wizard-frame`, body and footer classes remain. No fixed height, viewport hack or nested scroll added. |
| Stepper | product wizard composition with legacy paint | **REPLACE WITH SHARED COMPOSITION:** retained `Stepper` semantics now use semantic roles and Hugeicons; it is not treated as a clickable primitive. |
| Source selector | `OptionCard` compatibility consumer | **REPLACE WITH PRIMITIVE:** local semantic `WizardOption` uses a real registry `Button` and `aria-pressed`; source kinds, order and selection logic are unchanged. |
| URL source | local input/control paint | **REPLACE WITH PRIMITIVE:** registry `Field`, `Input` and `AsyncButton`; validation, platform allow-list, paste behaviour, analytics and async preview requests are unchanged. |
| Source library/upload | custom click rows and native file hand-off | **REPLACE WITH PRIMITIVE / EXCEPTION:** library actions are canonical Buttons and Dialog; the actual `input[type=file]` remains a necessary native specialised control. |
| Verified source | manual generic panel | **REPLACE WITH PRIMITIVE:** registry `Card`, `StatusBadge`, semantic heading and standard Button retain the existing media/facts grid geometry. |
| Wizard settings/actions | compatibility segmented choices and local actions | **REPLACE WITH PRIMITIVE:** direct `ToggleGroup`, `Select`, `Switch`, `Button` and `AsyncButton`; product-only `RangeTimeline`, `ValueBadge`, `LockedField` and `InfoPanel` retain their real HVE/control roles. |
| Projects topology | list/table information architecture | **KEEP AS PRODUCT/STRUCTURAL GEOMETRY:** `project-list` rows/columns and mobile collapse remain. Rows stay structural list rows; storage and the empty-state surface are registry `Card`, so no card-grid redesign was retained. |
| Projects filter/search | manual segmented/search/progress paint | **REPLACE WITH PRIMITIVE:** `ToggleGroup`, `Field`/`Input`, `Progress`, `Skeleton`, `EmptyState`, `StatusBadge`, Dialog and Buttons. Search/filter/delete state logic is unchanged. |
| Icons in touched code | Lucide direct imports | **REPLACE WITH SHARED COMPOSITION:** touched files use Hugeicons through `AppIcon`. `layoutOptions` is shared with the clip editor and retains its existing Lucide source until Phase 7.4, rather than broadening this wave into editor work. |
| `ChoiceSegmented` | one wizard consumer, legacy ToggleGroup wrapper | **REMOVE AS LEGACY VISUAL CODE:** no active consumer remains; the wrapper was deleted. |
| `OptionCard` | shared wizard/editor wrapper | **DEFER:** now has only the deferred clip-editor consumer; Phase 7.2 does not migrate editor controls. |
| Dashboard CSS | duplicated product and route-specific rules | **CLASSIFY, DO NOT MASS DELETE:** topbar profile/balance, old selector/input/filter and manual project-progress paint used by this wave were removed or replaced. Shell grid/breakpoints, wizard frame/footer/source-facts geometry and project-list responsive columns remain as product structure. Workspace/editor/billing/help/style-studio regions are deferred to their own waves. |

## Functional impact audit

Codebase Memory reindex and trace of `NewProjectWizard` confirms that the wave
still connects to `useProjectProcessing`, `createSourcePreview`,
`getSourcePreview`, `createMultipartUpload`, `createProject`, `trackApp`,
`listSources`, `layoutToApi` and the real dashboard store. No control API,
analytics, source validation, credit calculation, ClipEDL, renderer or HVE
contract changed.

`ProcessingCard` and `ProgressStage` are shared by the wizard and project
workspace. Their shared implementation now uses canonical Card/Progress and
Hugeicons, but the workspace route itself is not migrated or visually accepted
in this wave. Its route-level browser review remains Phase 7.3 work.

## Static system evidence

- Direct Lucide imports in Phase 7.2 route/shared files: none. The one indirect
  `layoutOptions` dependency above is documented deferred editor work.
- `ChoiceSegmented` and `hp-choice-segmented`: no active code match. Historical
  Phase 5 records are retained as history only.
- Source selector, URL input, project filters/search and standard actions use
  registry `Button`, `Field`, `Input`, `ToggleGroup`, `Card`, `Dialog`,
  `Progress`, `Skeleton` and `Tooltip`.
- The only raw input in the source wizard is the native file picker exception.
- No `--hp-*`, `--dash-*`, Manrope/Mira product font, HeroUI control or raw
  button was added in the touched route code.
- `npm run audit:product-ui` now tests the active b37/Vega portal contract
  (root-theme inheritance and no `.hp-overlay-scope`) rather than its retired
  b38 requirement, and passes with 18 preset roles and 25 shared compositions.
- `npm run audit:dark-surfaces` passes for the dashboard and public CSS inputs.

## Browser evidence and open matrix

Authenticated local test-admin evidence on `http://localhost:3001` at
1280×720:

- `/dashboard`: source selector is real Buttons with selected state; URL
  validation produces the existing textual platform error; `DropdownMenu`
  opens on the profile action, closes with Escape and returns focus to its
  trigger. Wizard frame computes `min-height: 0`, `overflow-y: visible` and
  equal client/scroll height; no nested scroll was detected. Document width
  equals viewport width.
- `/dashboard/projects`: connection/loading then real empty storage state was
  observed; search and `ToggleGroup` filter update state, and document width
  equals viewport width. No browser runtime error was observed.

The local browser controller currently exposes only its 1280×720 application
viewport, and the local account has no actual uploaded/processing/ready/failed
project. Therefore the 360/768/1024/1440 matrix, source-confirmed/processing,
project populated/delete-dialog and error/retry states are explicitly
**blocked**, not inferred from source. The detailed route review is appended to
`docs/verification/product-page-review.md`; Phase 7.2 cannot be marked
visually accepted until those real browser states are available.

## Technical verification

- `git diff --check` — pass.
- `npx shadcn@latest diff` — pass (`No updates found.`); no registry primitive
  source was edited in this wave.
- `npm run typecheck` and `npm run lint` — pass.
- `npm run test:unit` — 197 pass, 0 fail.
- `npm run build:vercel` — pass; 27 routes generated, including dashboard and
  projects routes.
- Codebase Memory full live reindex completed (6,854 nodes, 15,854 edges), then
  impact tracing confirmed the retained source-processing and shared
  ProcessingCard dependencies. Its persistence writer emitted an empty binary
  placeholder, so the pre-existing tracked `.codebase-memory` artifact was
  deliberately restored and excluded from this UI commit.

## Phase exit

Implementation and technical checks can be committed independently of the
blocked visual evidence. This document deliberately does not authorise Phase
7.3 or a dashboard redesign.
