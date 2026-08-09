---
name: hashpix-product-ui
description: Build, change, or review Hashpix product UI using the canonical shadcn `b37sSWfzM` target (Vega, Hugeicons, Geist) without a competing visual system.
---

# Hashpix Product UI

Preserve Hashpix information architecture and working flows. Its internal visual
system is the approved shadcn target: preset `b37sSWfzM`, Vega, Hugeicons and
Geist. Hashpix does not own a second colour, radius, focus, icon or control
system.

## Read first

1. `docs/ui/design-system.md`.
2. `docs/ui/verification-protocol.md`.
3. `docs/design/hashpix-product-system.md` for feature behaviour only.
4. `.claude/skills/no-dead-ui/SKILL.md`.
5. `.claude/skills/hashpix-page-verification/SKILL.md` before claiming a page is complete.
6. HVE skills and architecture documents when the work touches the clip editor.

## System contract

- Use only the target preset semantic roles: `background`, `foreground`,
  `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`,
  `border`, `input`, `ring`, `sidebar`, charts and `radius`.
- Do not introduce `--hp-*`, `--dash-*`, local palettes, focus systems, radius
  scales or legacy visual wrappers.
- `components/ui` is the canonical location for registry shadcn primitives.
  Use their standard `onClick`, `disabled`, variant, size and compound-overlay
  APIs unchanged.
- `components/hashpix` may contain only functional compositions (loading,
  locked capability and real status), never a visual compatibility layer.
- The preset controls own their focus ring, hover, radius and height. Do not
  wrap an Input with a second border/ring or restyle a Button into a new visual
  primitive.
- Use Hugeicons for new internal product icons. Existing icon imports are a
  Phase 2 migration inventory, not permission to add more Lucide icons.
- Use Geist for application UI. `typeset` is opt-in rich-content typography,
  never dashboard/editor control typography.
- Do not copy competitor branding, screens, copy, or interaction details.
  Adopt a verified interaction principle only when it fits Hashpix HVE.

## Build workflow

1. Identify the user task and one primary action for the current view.
2. Map every visual role to a system token before JSX/CSS work.
3. Select the installed target registry primitive before creating a composition.
   During the staged migration, do not use a missing primitive as justification
   for imitating it with local markup.
4. Wire a real capability. If the API/renderer cannot perform it, use
   `LockedField` with the true reason.
5. Implement all state families: default, hover, pressed, focus-visible,
   selected, disabled, loading, error and empty where relevant.
6. Check desktop and mobile using the page-verification skill.

## Product conventions

- The editor is a focus tool: transcript, canvas, contextual tools, transport.
  Do not turn it into a dashboard, a freeform NLE, or an accordion wall.
- Preserve keyboard reachability and visible focus. Icons without visible text
  require an `aria-label` and a tooltip.

## Handoff gate

Report the route/state matrix inspected, target primitives used or added,
exceptional semantic values, and remaining backend-locked capabilities. Never
call a visual change finished from a build alone.
