# Phase 7.3 — Project Workspace audit

Date: 2026-08-10
Branch: `codex/shadcn-ui-migration`
Foundation: `b37sSWfzM` / Vega / Hugeicons / Geist

## Scope guard

This wave preserves the Project Workspace information architecture: header,
moments/review split, transcript and settings right-side sheets, ready-clips
view, media thumbnails and preview geometry. It does not change ClipEDL, HVE,
the preview clock/crop/layout geometry, media APIs, render/billing contracts or
the clip editor. Consequently no HVE gate is applicable to this UI-only wave.

## Before / after implementation audit

| Surface | Before | Applied canonical implementation | Behaviour retained |
| --- | --- | --- |
| View switcher | `ToggleGroup` used as manual tabs | registry `Tabs`, `TabsList`, `TabsTrigger`, registry `Badge` counts | order, local active state and conditional views |
| Header/actions | `ActionButton` bridge and Lucide | `AsyncButton`, `Button`, `IconButton`, `AppIcon`/Hugeicons | transcript/settings triggers, render/download actions and analytics |
| Review inspector and empty/results | manual generic panel/card styling | registry `Card`, `CardContent`, `CardTitle`, `CardDescription` | media preview, moment selection and ready-clip data |
| Transcript/settings drawers | `HashpixDrawer` wrapper around Sheet | direct registry `Sheet`, `SheetHeader`, `SheetContent`, `SheetFooter` | right-side model, Escape/outside close and focus return |
| Settings controls | `ChoiceSelect`, `ChoiceSwitch`, custom field labels | registry `Field`, `Select`, `Switch` | search mode/count/duration, style ID and caption/silence values |
| Inputs and text | route-local title-input paint | registry `Field`, `Input`, `Textarea`, semantic Page/Section roles | title save-on-blur, transcript revision editing/search |
| Icons | direct Lucide imports | `AppIcon` over Hugeicons | all touched visual actions only |
| Drawer wrapper | single workspace consumer | removed `components/hashpix/drawer.tsx` | no remaining consumer |

## Preserved contracts

- `getProject`, `getTranscript`, `updateMoment`, `updateProject`,
  `createMomentSearch`, `createTranscriptRevision`, `renderSelectedMoments`
  and `getClipPlayback` are unchanged.
- Moment selection remains optimistic with rollback; title, boundaries,
  transcript revisions, style selection, search values, render, downloads,
  polling, status and error messages retain their existing code paths.
- The per-moment layout choice remains an honest `LockedField`; it is not
  converted into a selectable control because the backend does not persist it.
- Specialist media thumbnail and subtitle-preview geometry remains outside the
  generic Card conversion.

## Workspace CSS classification

- **Removed:** custom generic tab/button/input/card paint; tab active/count
  recipes; route-local Input focus/typography; drawer-wrapper/mobile overrides;
  style-option card paint; legacy colour bridge entries for workspace controls.
- **Kept:** review-grid placement, sticky inspector, moment-list grouping,
  media aspect/thumbnail placement, transcript row layout, responsive columns
  and project-specific sheet body scrolling.
- **Deferred:** clip editor/timeline CSS and all untouched route regions to
  their assigned later waves.

## Browser evidence and verification debt

Preview evidence used `http://localhost:3001/dashboard/projects/podcast-24`
under the local test admin. It is an offline/demo project, not proof of a real
media API job.

- 360, 768, 1024 and 1440 viewport overrides: `scrollWidth === innerWidth`.
- Moments and ready tabs changed state; the ready view rendered three registry
  Cards without overflow.
- Settings Sheet opened at 360px with its canonical full-width mobile layout;
  registry Select and Switch changed local state; Escape closed the Sheet and
  returned focus to the `Параметры` trigger.
- Transcript Sheet opened, exposed the named search Input and closed on Escape
  with focus returned to `Транскрипт`.
- A fresh browser tab after hot reload contained no console warnings/errors.

The following are deliberately **blocked**, not verified: real API loading,
error/retry and permission states; real project processing/empty/ready/failed
fixtures; transcript revision persistence and boundary mutation against a real
transcript; real render/download/polling; any destructive confirmation (this
route has no destructive action); and saved screenshot artefacts. The Phase
7.2 responsive/state debt remains unchanged and open.

## Technical verification

- `git diff --check`, `npm run typecheck`, `npm run lint` and
  `npm run test:unit` — pass (197 unit tests).
- `npm run test` — pass, including rendered-HTML checks; `npm run build:vercel`
  — pass with `/dashboard/projects/[id]` retained as a dynamic route.
- `npm run audit:product-ui`, `npm run audit:dark-surfaces` and
  `npx shadcn@latest diff` — pass. The latter reports `No updates found.`
- Full Codebase Memory reindex — pass (6,895 nodes, 16,227 edges). Its outbound
  impact trace confirms that `ProjectWorkspace` still reaches the same control
  API, project-processing and media paths, while the UI edge set now resolves
  to registry Tabs/Card/Field/Select/Switch/Sheet/Button primitives and the
  existing functional Hashpix compositions.
- No workspace-specific automated test exists. This is recorded as test-scope
  debt, rather than treating the global suite as direct real-state coverage.

## Static system evidence

- No `ActionButton`, `ChoiceSelect`, `ChoiceSwitch`, `HashpixDrawer`, direct
  Lucide import, `--hp-*` or `--dash-*` use remains in
  `project-workspace.tsx`.
- `components/ui` is not edited; `npx shadcn@latest diff` remains the registry
  parity check.
- `HashpixDrawer` has no consumer and is removed rather than retained as a
  compatibility layer.
