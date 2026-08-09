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
| Route CSS layer | `app/dashboard/dashboard.css` (5,416), `app/admin/admin-minimal.css` (104), auth CSS | Legacy/custom feature visual implementation to migrate | Captured; route work is still pending |
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
| Internal product routes | 17 |
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
| `ChoiceSegmented` | one wizard consumer; wraps ToggleGroup with legacy classes | DEFER | Replace with direct ToggleGroup during wizard migration |
| `HashpixDrawer` | workspace drawer; wraps Sheet with `dash-drawer-dialog` | DEFER | Replace with direct Sheet in workspace migration |
| `OptionCard` | wizard/editor choices with feature state and local classes | DEFER | Replace with ToggleGroup/Card semantics per feature migration |
| `InfoPanel` | one wizard consumer, legacy tone/icons/classes | DEFER | Re-evaluate against primitive/alert content during wizard migration |

The target preset and complete canonical primitive set remain registry-verified.
Feature routes have not adopted these Phase 5 compositions; route migration
and visual QA remain open under the master-spec.
