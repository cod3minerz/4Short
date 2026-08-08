# Hashpix internal design system

Migration status: [shadcn progress](../migrations/shadcn-migration-progress.md)

## Layers

1. `components/ui`: canonical registry shadcn/Base UI primitives.
2. `components/hashpix`: functional product compositions and states only.
3. Internal routes: composition, data and business behavior only.

## Semantic contract

- Internal product routes use the canonical `b38miVLH6` root and `.dark`
  variables verbatim. There is no `--hp-*` visual-token layer.
- `--radius` is `.625rem`; derived radii come only from the generated shadcn
  Tailwind mapping.
- Dark product primary is indigo (`oklch(0.398 0.195 277.366)`), with the
  canonical neutral surfaces, border, input and ring values.
- Geist is the only internal product font.

## Component rules

- Use official shadcn compound APIs and standard React event/disabled props.
- Product loading/locked-state behavior may live in `components/hashpix`, but
  it must compose stock primitives without styling compatibility shims.
- Field errors stay beside their field. Sonner is for transient cross-view feedback.
- Every control executes a real capability or renders as `LockedField` with the true reason.
- Route files must not introduce colors, radii, shadows, focus rings, or local primitive implementations.
