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

`AGENTS.md` activates product UI and page-verification skills. Those skills and
the existing migration documentation still name b38/base-mira as canonical.
The approved master-spec names b37sSWfzM as canonical. This is an active
instruction conflict. Phase 1 must deprecate/replace the b38 visual guidance
without removing product/HVE safety rules.

Until that change, the master-spec has precedence for migration decisions;
legacy code and b38 material are behavioural/migration references only.

## Phase 0 exit criterion

This inventory is intentionally open. It is closed only after the target preset,
canonical primitive set, active instruction hierarchy, component consistency,
and visual QA are all verified under the master-spec.
