# Phase 5 — UI typography and shared composition audit

Date: 2026-08-09
Scope: shared product foundation only; no route migration.

## Targeted evidence

| Semantic concern | Implementations found | Conclusion |
| --- | ---: | --- |
| Page heading | dashboard `PageHeading` (5 callers), local admin `SectionHeader` (5 callers) | Same semantic page-header role, historically divergent layout/CSS; canonical shared header justified |
| Section heading | settings/account/workspace section markup plus admin headings | Canonical section-header role justified; exact feature layouts remain deferred |
| Loading action | `ActionButton` has 7 consuming feature components | A behavioural wrapper is justified, but its visual `tone` compatibility cannot be removed before consumers migrate |
| Icon action | `IconButton` has 4 consumers | One canonical Button `size="icon"`, label and tooltip contract justified |
| Empty state | admin helper (5 consumers), dashboard local empty markup | Structure repeats; shared empty-state composition justified, adoption deferred |
| Loading state | one local admin implementation | No shared surface justified; use registry Skeleton in route migration |
| Locked capability | `LockedField` has 3 consumers | Real no-dead-UI semantic composition; registry Field refactor justified |
| Domain status | shared `StatusBadge` used by workspace | Limited mapping over registry Badge remains justified |
| Feature choices/drawers/info | `ChoiceSegmented` (1), `HashpixDrawer` (workspace), `OptionCard` (wizard/editor), `InfoPanel` (1) | Their safe removal needs feature-specific migration; all deferred |

## Canonical implementations introduced

| File | Role | Boundaries |
| --- | --- | --- |
| `components/hashpix/typography.tsx` | named page/section headings and compact body/label/muted/caption CVA recipe | no typeset, no CardTitle duplicate |
| `components/hashpix/page-header.tsx` | page title, description and optional actions | no card/panel or feature layout |
| `components/hashpix/section-header.tsx` | section title, description and optional actions | no dashboard/admin variant |
| `components/hashpix/async-button.tsx` | loading/disabled/`aria-busy` over registry Button | no colour, radius, height, padding or tone API |
| `components/hashpix/action-button.tsx` | deprecated temporary route compatibility plus canonical icon-button entrypoint | `tone` is migration debt, not a new API |
| `components/hashpix/app-icon.tsx` | Hugeicons size/stroke contract | no colour or alternate icon visual system |
| `components/hashpix/empty-state.tsx` | structural empty state | no surface; caller chooses Card/panel |
| `components/hashpix/locked-field.tsx` | truthful unavailable capability over registry Field | must display a real reason |
| `components/hashpix/status-badge.tsx` | semantic domain state over registry Badge | no local badge visuals |

## Field and typography rules

- Future fields use registry `Field`, `FieldLabel`, `FieldContent`,
  `FieldDescription` and `FieldError`; the unused legacy
  `components/hashpix/field.tsx` has zero active imports and is not a valid new
  dependency.
- `PageTitle` is exactly `text-2xl font-semibold tracking-tight`; `SectionTitle`
  is exactly `text-lg font-semibold`. Body, label, muted and caption roles use
  the shared recipe. Registry `CardTitle` remains the only card-title role.
- `typeset` remains untouched and applies only to its existing rich-content
  surfaces.

## Verification evidence

- `npx shadcn@latest diff` — pass (`No updates found.`); `components/ui/**`
  was not modified in this phase.
- `git diff --check` — pass.
- `npm run typecheck` — pass.
- `npm run lint` — pass; targeted lint of all new/changed Hashpix compositions
  also passes.
- `npm run test:unit` — 196 passing tests.
- `npm run build:vercel` — pass; 28 routes generated.
- Codebase Memory full reindex/impact audit — pass (6,847 nodes, 15,852 edges).
  It confirms `AsyncButton` is the sole shared button foundation; `AppIcon`
  reaches only `AsyncButton` and `LockedField`; and the newly-created headers
  and empty state have no route consumers yet.
- Static audit of changed shared files — no arbitrary 13/15/22px typography,
  custom radius, product token aliases or feature-route imports were added.
- No feature route was changed or claimed browser-verified. Page-level visual,
  keyboard and responsive evidence begins only when a Phase 6 route adopts the
  foundations above.
- The final command results and Codebase Memory impact audit are appended to
  the Phase 5 completion commit record.
