# Product UI verification protocol

Use this protocol with `docs/ui/design-system.md` after every product UI phase.
A green build is necessary but never visual-system acceptance evidence.

## Static system audit

Search active instructions and changed product code for legacy leaks:

- b38/Mira, HeroUI product controls, Manrope product typography, Lucide as the
  product icon standard;
- `--hp-*`, `--dash-*`, legacy primitive paths and duplicated UI recipes;
- raw primitive substitutes and arbitrary typography/geometry values.

Classify every match as a target-compliant implementation, functional
non-visual rule, intentional historical/archive reference, or unresolved
conflict. An archive match is never a reason to restore legacy behaviour.

`npm run audit:product-ui` is the required executable version of this review.
It verifies the Vega preset/theme/font/icon foundation, registry ownership,
public HeroUI boundary, semantic headings, Typeset boundary, raw-control and
arbitrary-value exceptions, and the scoped dashboard geometry checksum. CI
runs it with `npm run audit:dark-surfaces`; any new unclassified exception
fails before merge. See `docs/ui/product-ui-allowlist.md` for the reviewed
exception register.

## Preset and component audit

After the foundation phase, prove that `components.json`, theme variables,
fonts, icon library, base style and generated primitives match `b37sSWfzM`.
For each core primitive, inventory variants, sizes and local `className`
overrides. A local layout adjustment is valid only when it does not redefine
primitive geometry, typography, colour, radius or focus behaviour.

## Typography and semantic audit

Inventory page title, section title, card title, label, body, muted and caption
roles across changed surfaces. Flag multiple visual recipes for the same role.
Verify that `typeset` appears only on rich-content roots.

## Browser evidence

For every migrated route, capture the route/state matrix in
`docs/verification/product-page-review.md` at 360, 768, 1024 and 1440 px.
Record URL, auth/data state, screenshot, overflow computation, console errors,
keyboard/focus behaviour, overlays and controls actually exercised.

Review at least one normal page, complex form, settings page, card surface,
dialog, dropdown/popover, destructive confirmation, empty state and dark-mode
surface. HVE/editor changes also run their applicable HVE gates; an
`INSUFFICIENT` gate remains a blocker, never a pass.

When an authenticated browser fixture is unavailable, record the exact
environmental cause and retain the route as **BLOCKED WITH EXTERNAL/
ENVIRONMENT REASON**. Static, SSR, registry and accessibility-source evidence
can establish architectural completion, but cannot be relabelled as browser
PASS.

## Phase acceptance

Do not mark a phase complete until its changed code has relevant lint/type/test
coverage, the static audit is classified, browser evidence exists, active
instruction paths name only the target system, and no product control promises
a backend/renderer capability that does not exist.
