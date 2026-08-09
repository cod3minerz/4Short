# Phase 2 — isolated Vega preset audit

Status: **PASS — foundation applied; no feature migration performed**

## Pre-apply and recovery evidence

The initial exact apply attempts from a clean branch were blocked by transient
shadcn registry/npm network transport failures. They left no source diff; their
Codebase Memory artifacts were preserved separately. After registry/npm became
available again, the exact permitted command completed successfully:

```bash
npx shadcn@latest apply --preset b37sSWfzM
```

No alternative preset, `init`, `--force`, hand-copied primitive, feature-code
workaround, or legacy-visual override was used.

## Applied diff classification

| Changed files | Classification | Verified result |
| --- | --- | --- |
| `components.json` | Expected preset change | `style: base-vega`, `baseColor: neutral`, CSS variables, `iconLibrary: hugeicons`. |
| `app/globals.css` | Expected preset change | Canonical `background`, `foreground`, `muted`, and `accent` variables placed in the preset token block. Existing legacy CSS remains intentionally untouched for later phases. |
| `package.json`, `package-lock.json` | Required dependency/config change | Official CLI installed `@hugeicons/react@^1.1.9` and `@hugeicons/core-free-icons@^4.2.3`. |
| `components/ui/alert-dialog.tsx`, `badge.tsx`, `button.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `field.tsx`, `input.tsx`, `label.tsx`, `popover.tsx`, `progress.tsx`, `select.tsx`, `sheet.tsx`, `switch.tsx`, `table.tsx`, `textarea.tsx`, `toggle-group.tsx`, `toggle.tsx` | Expected registry rewrite | Official Vega anatomy, geometry, typography, focus treatment and Hugeicons primitive internals. No compatibility edits were added. |
| `.codebase-memory/artifact.json`, `.codebase-memory/graph.db.zst` | Generated metadata | Separate index artifact, not UI foundation. Final full reindex completed with 6,709 nodes and 15,380 edges. |
| Feature routes, shared product compositions, legacy CSS cleanup, typography migration | Not changed | Correctly outside Phase 2 scope. |

The CLI skipped `ScrollArea`, `Separator`, `Skeleton`, and `Tooltip` because
they already matched the registry. `npx shadcn@latest diff` after apply returns
`No updates found.` This establishes registry correspondence for every existing
primitive that the preset changed or retained.

## Canonical foundation confirmation

- `components.json` is the target `b37sSWfzM` configuration: `base-vega`,
  neutral base colour, CSS variables and Hugeicons.
- `Button` default geometry is `h-9`; `Input` geometry is `h-9`.
- Dialog, Sheet, DropdownMenu and Select now use Hugeicons internally through
  the registry source. No feature-level Lucide import was changed in this
  phase.
- `app/layout.tsx` already provides `TooltipProvider`; the registry requirement
  needs no Phase 2 root-layout change.
- `git diff --check` and `npx shadcn@latest diff` pass. The latter confirms no
  local compatibility modification in the registry-managed primitives.

## Verification

| Check | Result |
| --- | --- |
| Registry/npm availability | PASS: exact official `apply` completed after transient blocker cleared. |
| `npx shadcn@latest diff` | PASS: `No updates found.` |
| `git diff --check` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS: 196 tests |
| `npm run build:vercel` | PASS: 28 routes |
| `npm run audit:product-ui` | PASS: 18 preset roles, 19 shared compositions |
| Codebase Memory full reindex | PASS: 6,709 nodes / 15,380 edges, persisted artifact written |

Route browser QA is not applicable evidence for this phase: no route, feature
composition or product interaction changed. Route/state visual verification is
required in the later route-migration phase.

## Explicit pending Phase 4 component work

`Card`, `Checkbox`, `Tabs`, `Slider`, `InputOTP`, and `Sidebar` are not present
in `components/ui`. They are **pending Phase 4 component work** only: they were
not installed, are not a Phase 2 failure, and must not be represented as
completed foundation work. They will be added through the official registry in
their assigned phase, not imitated with local markup meanwhile.

## Migration impacts for subsequent phases

1. Vega changes default control geometry from the prior compact `h-7` baseline
   to `h-9`, plus target text/focus/radius treatments. Each consuming route
   requires visual regression and responsive QA; no legacy override may mask it.
2. Existing feature-level Lucide imports remain explicit migration debt: the
   reindexed product search finds 20 active feature/composition imports. New
   product primitives use Hugeicons; feature icon migration is deferred.
3. The existing root `TooltipProvider` satisfies the registry prerequisite. Any
   subsequent icon-only product control still needs its own accessible label and
   tooltip contract.
4. Existing legacy CSS/token layers remain untouched and are not target-system
   evidence. Their cleanup is deferred to later approved phases.
