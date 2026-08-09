# Shadcn migration inventory — Phase 5 shared-foundation state

Date: 2026-08-09
Migration branch baseline: `b110fe5`
Target foundation (approved master-spec): `b37sSWfzM`

This is an evidence inventory, not a route-migration completion record. Phase 2
changed only the official preset foundation; product routes remain pending.

## UI systems currently present

| Source | Evidence | Relevance after migration | Phase 0 result |
| --- | --- | --- | --- |
| Current shadcn foundation | `components.json`: `base-vega`, neutral, Hugeicons, CSS variables | Canonical target foundation | Applied and registry-verified |
| Product foundation CSS | `app/globals.css` | Exact Vega semantic map, root dark mode and Geist variables | Phase 3 complete; no product legacy palette or overlay bridge remains in this foundation file |
| Route CSS layer | `app/dashboard/dashboard.css` (5,416), `app/admin/admin-minimal.css` (104) | Legacy/custom feature visual implementation to migrate | Auth-specific CSS was removed in Phase 7.1; remaining route work is pending |
| Registry primitives | `components/ui` has 21 primitives | Canonical primitive location | Existing sources registry-verified after Vega apply; target gaps listed below |
| Hashpix compositions | `components/hashpix` has 19 files | Retain only behaviour-backed compositions after primitive audit | Captured; visual ownership must be reviewed |
| Historic b38 migration docs and skills | migration ledgers, product UI skills, audit script | Conflicts with target preset and cannot remain active UI guidance | Conflict recorded for Phase 1 |
| Public UI | `/` and `/blog/**` | Out of product migration scope; visual regression controls | Isolated behind `app/public-boundary.css`; HeroUI and preserved marketing typography are public-only |

## Current primitive baseline

Present: `AlertDialog`, `Badge`, `Button`, `Dialog`, `DropdownMenu`, `Field`,
`Input`, `Label`, `Popover`, `Progress`, `ScrollArea`, `Select`, `Separator`,
`Sheet`, `Skeleton`, `Switch`, `Table`, `Textarea`, `ToggleGroup`, `Toggle`,
`Tooltip`.

The canonical minimal set is complete: `Card`, `Checkbox`, `Tabs`, `Slider`,
`InputOTP`, and `Sidebar` were generated from the Vega registry in Phase 4.
`hooks/use-mobile.ts` is the matching registry helper for Sidebar and
`input-otp` is its only new runtime dependency. These primitives are installed
but have no new feature consumers yet.

## Static baseline metrics

| Check | Result |
| --- | ---: |
| Internal product routes | 16 (after Phase 6 decommissioned `/dashboard/styles`) |
| Public control routes | `/`, `/blog`, `/blog/[slug]` |
| Internal HeroUI imports | 0 |
| Files importing Lucide internally | 25 |
| Raw `<button>` in internal routes/shared UI | 0 |
| Raw `<input>` in internal routes/shared UI | 12 |
| `text-[…]` / `rounded-[…]` occurrences | 7 |
| Product CSS lines | 9,644 |

The absence of raw buttons or HeroUI imports is not a visual-system pass: local
CSS and custom compositions still own much of the product geometry.

## Instruction inventory and precedence finding

Phase 1 decommissioned the conflicting legacy visual instruction paths without
removing product/HVE safety rules. The classification and current hierarchy are
recorded in `docs/ui/instruction-inventory.md`. Existing implementation values
remain baseline facts until their assigned foundation/component phases.

## Phase 3 theme and public-boundary state

- The product root carries the canonical exact `b37sSWfzM` light and dark maps;
  its default class is `.dark` and `--radius` is `0.625rem`.
- `next/font/google` exposes `--font-geist` and `--font-geist-mono` with Latin
  and Cyrillic glyph coverage. Product controls resolve through the target
  semantic variables rather than `--hp-*`, `--dash-*`, Manrope or marketing
  layout tokens.
- `@heroui/styles`, the local public `Geist Variable` faces, marketing type
  rules and `landing.css` are imported only by `app/public-boundary.css`, which
  is mounted by `/` and `/blog/**`. They are not part of the product root.
- `.hp-overlay-scope` and its portal-specific CSS are removed. Dialog and
  Popover portals inherit root dark tokens and the canonical `popover` role;
  feature-level overlay visual work remains pending its component phase.

## Foundation state and route-migration criterion

## Phase 5 shared composition audit

| Candidate | Evidence | Decision | Migration path |
| --- | --- | --- | --- |
| `PageHeader` | dashboard `PageHeading` has 5 callers; admin local header has 5 | KEEP AS CANONICAL COMPOSITION | Adopt in Phase 6 without carrying route CSS/layout assumptions |
| `SectionHeader` | repeated settings/admin section title+description+actions role | KEEP AS CANONICAL COMPOSITION | Adopt in Phase 6; admin search remains feature content |
| `AsyncButton` | `ActionButton` has 7 consumers and shared loading semantics | KEEP AS CANONICAL COMPOSITION | New code uses `AsyncButton`; legacy `tone` bridge is retired after route migration |
| `IconButton` | 4 existing consumers, icon-only actions need label+tooltip | KEEP AS CANONICAL COMPOSITION | Now always uses canonical `size="icon"`; later routes replace legacy tone |
| `AppIcon` | Vega registry uses Hugeicons; 25 product files still import Lucide | KEEP AS CANONICAL COMPOSITION | New shared code uses adapter; feature icon migration is Phase 6 work |
| `EmptyState` | admin local helper has 5 consumers; dashboard has separate empty markup | KEEP AS CANONICAL COMPOSITION | Generic structural state added; route adoption deferred |
| `LoadingState` | only local admin helper (5 calls) | REPLACE WITH PRIMITIVE | Use `Skeleton` during admin migration; no project loading surface added |
| `StatusBadge` | shared workspace domain status mapping | KEEP AS CANONICAL COMPOSITION | Retain limited semantic-to-Badge mapping |
| `LockedField` | three product consumers, unavailable-capability contract | KEEP AS CANONICAL COMPOSITION | Refactored to registry Field anatomy; retain real lock reasons |
| `components/hashpix/field.tsx` | no active imports | DEFER / REMOVE IN PHASE 7 | Do not use; registry `Field` is the only future field composition |
| `ChoiceSegmented` | former one wizard consumer; wraps ToggleGroup with legacy classes | REMOVED — Phase 7.2 | Wizard now uses direct registry ToggleGroup; no active code consumer remains |
| `HashpixDrawer` | workspace-only Sheet wrapper | REMOVED — Phase 7.3 | Direct registry Sheet now owns the workspace drawers; no consumer remains |
| `OptionCard` | final editor choice consumer was the save-scope selector | REMOVED — Phase 7.4 | Replaced by direct registry `ToggleGroup`; no compatibility wrapper remains |
| `InfoPanel` | one wizard consumer, legacy tone/icons/classes | DEFER | Re-evaluate against primitive/alert content during wizard migration |

The target preset and complete canonical primitive set remain registry-verified.
Feature routes have not adopted these Phase 5 compositions; route migration
and visual QA remain open under the master-spec.

## Phase 6 style-management boundary

The style domain remains runtime infrastructure: hydration calls `listStyles`,
the wizard selects a hydrated preset and submits its `styleVersionId`, and the
workspace persists its selected `styleId` for later renders. The standalone
management route, its view and only its dead client-side mutation helpers are
removed. Backend `/v1/styles` routes, schema, contracts, versioning and
renderer/HVE consumers are intentionally retained.

## Phase 7.1 auth-wave state

`/sign-in`, `/sign-up` and `/forgot-password` now use registry `Card`,
`Field`, `Input`, `InputOTP`, `Button` and `Tooltip`, plus the behavioural
`AsyncButton`, `AppIcon` and semantic typography compositions. Their shared
`AuthScreen` has no local visual classes, Lucide import or `sign-in.css`; the
only local classes are structural layout and the registry Input's necessary
password-toggle clearance. Better Auth transport and OTP/reset behaviour are
unchanged. See `shadcn-phase-7-1-auth-audit.md`.

## Phase 7.2 dashboard-wave state

`/dashboard` and `/dashboard/projects` now consume canonical Vega primitives
without changing their approved shell, wizard or projects-list architecture.
`Sidebar` remains an installed-but-unused primitive because adopting it would
replace the product sidebar composition. `OptionCard` and `ChoiceSegmented` are
removed after their final editor/wizard consumers moved to direct registry
`ToggleGroup`. The detailed current classification is
`shadcn-phase-7-2-dashboard-audit.md`; final browser state coverage is pending.

## Phase 7.4 Clip Editor state

The Clip Editor now uses canonical Vega controls and Phase 5 compositions for
ordinary UI while retaining specialist HVE/media/timeline geometry. Its native
colour picker is an explicitly documented exception; `RangeTimeline`, preview
overlays and timecode retain their functional geometry. The audit record is
`shadcn-phase-7-4-clip-editor-audit.md`. Browser verification is blocked by
the rejected local test-admin credential, not considered complete.
