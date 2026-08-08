---
name: hashpix-product-ui
description: Build, change, or review Hashpix product UI. Internal routes use the canonical shadcn `b38miVLH6` preset without a competing Hashpix visual system.
---

# Hashpix Product UI

Preserve Hashpix information architecture and working flows. Its internal visual
system is shadcn `base-mira`, preset `b38miVLH6`, exactly; Hashpix does not own
a second colour, radius, focus, or control system.

## Read first

1. `docs/design/hashpix-product-system.md`.
2. `.claude/skills/no-dead-ui/SKILL.md`.
3. `.claude/skills/hashpix-page-verification/SKILL.md` before claiming a page is complete.
4. Do not add HeroUI to an internal route. It remains public landing/blog-only.
5. HVE skills and architecture documents when the work touches the clip editor.

## System contract

- Use only the preset CSS roles: `background`, `foreground`, `card`,
  `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`,
  `border`, `input`, `ring`, `sidebar`, charts and `radius`.
- Internal roots use `.dark`; Base UI portals use the same canonical roles.
  Do not introduce `--hp-*`, local palettes, focus systems or radius scales.
- `components/ui` contains registry shadcn primitives only. Use their standard
  `onClick`, `disabled`, variant, size and compound-overlay APIs unchanged.
- `components/hashpix` may contain only functional compositions (loading,
  locked capability and real status), never a visual compatibility layer.
- The preset controls own their focus ring, hover, radius and height. Do not
  wrap an Input with a second border/ring or restyle a Button into a pill.
- Do not copy competitor branding, screens, copy, or interaction details.
  Adopt a verified interaction principle only when it fits Hashpix HVE.

## Build workflow

1. Identify the user task and one primary action for the current view.
2. Map every visual role to a system token before JSX/CSS work.
3. Select the installed registry primitive: `Button`, `Input`, `Field`,
   `Select`, `ToggleGroup`, `Dialog`, `Sheet`, `Tooltip`, `Table`, `ScrollArea`
   or a functional Hashpix composition where it adds real behavior.
4. Wire a real capability. If the API/renderer cannot perform it, use
   `LockedField` with the true reason.
5. Implement all state families: default, hover, pressed, focus-visible,
   selected, disabled, loading, error and empty where relevant.
6. Check desktop and mobile using the page-verification skill.

## Product conventions

- Credit/minute affordance: black `Zap` in a white circular carrier followed
  by the numeric balance.
- Product routes use exactly `b38miVLH6` neutral/indigo Mira variables. Indigo
  is the preset primary; selected state and forward action use the stock
  shadcn component variants.
- The editor is a focus tool: transcript, canvas, contextual tools, transport.
  Do not turn it into a dashboard, a freeform NLE, or an accordion wall.
- Preserve keyboard reachability and visible focus. Icons without visible text
  require an `aria-label` and a tooltip.

## Handoff gate

Report the route/state matrix inspected, primitives used or added, any new
tokens, all intentionally bright surfaces, and remaining backend-locked
capabilities. Never call a visual change finished from a build alone.
