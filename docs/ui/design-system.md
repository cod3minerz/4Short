# Hashpix internal design system

Migration status: [shadcn progress](../migrations/shadcn-migration-progress.md)

## Layers

1. `components/ui`: unmodified or minimally token-adapted shadcn/Radix primitives.
2. `components/hashpix`: reusable product controls and states.
3. Internal routes: composition, data and business behavior only.

## Semantic contract

- Shadcn roles (`background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`) map to Hashpix `--hp-*` roles inside internal roots and portals.
- Compact controls use 14px corners, surfaces 18px, and workspaces 24px.
- Primary actions are neutral light on dark; blue is reserved for user media or configured brand content.
- Opaque tonal surfaces are the default. Glass is allowed only above media or an intentional ambient layer.
- Geist is the only internal product font.

## Component rules

- Use official shadcn compound APIs and standard React event/disabled props.
- Product loading/tone behavior belongs in `components/hashpix`, not compatibility shims in primitives.
- Field errors stay beside their field. Sonner is for transient cross-view feedback.
- Every control executes a real capability or renders as `LockedField` with the true reason.
- Route files must not introduce colors, radii, shadows, focus rings, or local primitive implementations.
