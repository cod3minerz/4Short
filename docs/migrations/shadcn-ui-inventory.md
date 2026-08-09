# Shadcn migration inventory — Phase 0 baseline

Date: 2026-08-09
Migration branch baseline: `b110fe5`
Target foundation (approved master-spec): `b37sSWfzM`

This is an evidence inventory, not a migration completion record. No UI source
was changed in Phase 0.

## UI systems currently present

| Source | Evidence | Relevance after migration | Phase 0 result |
| --- | --- | --- | --- |
| Current shadcn foundation | `components.json`: `base-mira`, neutral, Lucide, CSS variables | Transitional only: it conflicts with target `b37sSWfzM` | Captured; do not extend |
| Product CSS layer | `app/globals.css` (4,052 lines), `app/dashboard/dashboard.css` (5,416), `app/admin/admin-minimal.css` (104), auth CSS | Legacy/custom visual implementation to migrate | Captured; no edits |
| Registry primitives | `components/ui` has 21 primitives | Canonical primitive location after preset reconciliation | Captured; target gaps listed below |
| Hashpix compositions | `components/hashpix` has 19 files | Retain only behaviour-backed compositions after primitive audit | Captured; visual ownership must be reviewed |
| Historic b38 migration docs and skills | migration ledgers, product UI skills, audit script | Conflicts with target preset and cannot remain active UI guidance | Conflict recorded for Phase 1 |
| Public UI | `/` and `/blog/**` | Out of product migration scope; visual regression controls | Preserved as control surface |

## Current primitive baseline

Present: `AlertDialog`, `Badge`, `Button`, `Dialog`, `DropdownMenu`, `Field`,
`Input`, `Label`, `Popover`, `Progress`, `ScrollArea`, `Select`, `Separator`,
`Sheet`, `Skeleton`, `Switch`, `Table`, `Textarea`, `ToggleGroup`, `Toggle`,
`Tooltip`.

Not present but required by the approved target audit: `Card`, `Checkbox`,
`Tabs`, `Slider`, `InputOTP`, `Sidebar`. Their installation and integration are
Phase 1+ work, not evidence of completion.

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

## Phase 0 exit criterion

This inventory is intentionally open. It is closed only after the target preset,
canonical primitive set, active instruction hierarchy, component consistency,
and visual QA are all verified under the master-spec.
