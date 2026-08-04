---
name: hashpix-product-ui
description: Build, change, or review any Hashpix dashboard, editor, admin, authentication, modal, drawer, or reusable React UI. Enforces the shared dark product system, semantic tokens, reusable primitives, consistent states, and no-hardcode rules.
---

# Hashpix Product UI

Build a coherent production tool, not a collection of page-specific CSS fixes.

## Read first

1. `docs/design/hashpix-product-system.md`.
2. `.claude/skills/no-dead-ui/SKILL.md`.
3. `.claude/skills/hashpix-page-verification/SKILL.md` before claiming a page is complete.
4. `heroui-react` guidance before adding a HeroUI component.
5. HVE skills and architecture documents when the work touches the clip editor.

## System contract

- Use `--hp-*` semantic tokens. Do not set visual hex, rgba, arbitrary radius,
  shadow, transition, or spacing values in a page/component stylesheet.
- Extend the named token layer when a real semantic role is missing. Do not
  duplicate a near-identical literal in a local component.
- Build a missing recurring control in `app/dashboard/components/ui/` first.
  Then use it everywhere. Raw controls are allowed only inside an existing
  primitive.
- Use HeroUI compound components and `onPress`, never a visually similar raw
  button with a guessed `slot` attribute.
- Keep button shape constant through default, hover, pressed, loading and
  disabled states. Buttons are pills; fields and panels are not.
- Do not use glass over a flat background. Glass is permitted only above real
  video/media or a deliberately rendered ambient-light layer.
- Do not copy competitor branding, screens, copy, or interaction details.
  Adopt a verified interaction principle only when it fits Hashpix HVE.

## Build workflow

1. Identify the user task and one primary action for the current view.
2. Map every visual role to a system token before JSX/CSS work.
3. Select a primitive: `ActionButton`, `IconButton`, `Field`, `Select`,
   `SegmentedControl`, `Dialog`, `Drawer`, `Tooltip`, `StatusBadge`,
   `LockedField`, or create the missing one in `components/ui/`.
4. Wire a real capability. If the API/renderer cannot perform it, use
   `LockedField` with the true reason.
5. Implement all state families: default, hover, pressed, focus-visible,
   selected, disabled, loading, error and empty where relevant.
6. Check desktop and mobile using the page-verification skill.

## Product conventions

- Credit/minute affordance: filled `Zap`, brand-blue circular carrier, numeric
  balance; never a gem, diamond or decorative currency icon.
- White is an intentional action fill, not a generic surface. Its hover stays
  neutral white/grey; it never changes into brand blue.
- Blue marks forward action, selected state and live progress. It does not
  decorate inactive cards or ordinary text.
- The editor is a focus tool: transcript, canvas, contextual tools, transport.
  Do not turn it into a dashboard, a freeform NLE, or an accordion wall.
- Preserve keyboard reachability and visible focus. Icons without visible text
  require an `aria-label` and a tooltip.

## Handoff gate

Report the route/state matrix inspected, primitives used or added, any new
tokens, all intentionally bright surfaces, and remaining backend-locked
capabilities. Never call a visual change finished from a build alone.
