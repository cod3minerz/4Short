# Hashpix Product System

## Scope

This system governs Hashpix product UI: sign-in, dashboard, editor, admin,
dialogs and mobile sheets. Marketing can share the brand accent but does not
inherit product surface rules.

## Principles

1. **Canvas is for work.** The clip, transcript and user decision receive the
   contrast; application chrome stays quiet.
2. **One semantic role, one token.** A value exists in the token layer before
   it exists in a component.
3. **Shape communicates object type.** Actions are pills. Inputs are fields.
   Containers are panels. Do not use one shape for everything.
4. **State never changes meaning.** A neutral or white control may brighten,
   but it does not become blue on hover.
5. **Glass shows context beneath it.** Use it over video/canvas or ambient
   media only; never as generic form decoration.
6. **Every promise is executable.** Unimplemented HVE features are locked with
   a reason, never styled as active controls.

## Token layer

Define product values once in the Hashpix product root. Component/page CSS must
consume these roles rather than create literal alternatives.

| Role | Token | Value |
| --- | --- | --- |
| Application canvas | `--hp-canvas` | `#08090C` |
| Base surface | `--hp-surface` | `#101116` |
| Raised surface | `--hp-surface-raised` | `#161820` |
| Quiet surface | `--hp-surface-subtle` | `#1B1E27` |
| Media stage | `--hp-media` | `#050609` |
| Border | `--hp-line` | `#2A2E38` |
| Strong border | `--hp-line-strong` | `#404653` |
| Primary text | `--hp-text` | `#F7F8FB` |
| Secondary text | `--hp-text-muted` | `#AAB1BE` |
| Tertiary text | `--hp-text-subtle` | `#7E8796` |
| Brand action | `--hp-brand` | `#3153FF` |
| Brand hover | `--hp-brand-hover` | `#4968FF` |
| Brand pressed | `--hp-brand-pressed` | `#253DDB` |
| White action | `--hp-action-light` | `#F7F8FB` |
| White hover | `--hp-action-light-hover` | `#E9ECF2` |
| White pressed | `--hp-action-light-pressed` | `#DDE1E8` |
| Success | `--hp-success` | `#32C982` |
| Warning | `--hp-warning` | `#E8B34C` |
| Danger | `--hp-danger` | `#F06B73` |

Foreground tokens accompany all interactive fills. Do not derive them inside a
component. The product accent is blue; white is a deliberate action fill, not
the dashboard's `--accent` replacement.

## Geometry

| Role | Token | Value |
| --- | --- | --- |
| Compact / regular / large control height | `--hp-control-{sm,md,lg}` | 32 / 36 / 40px |
| Action radius | `--hp-radius-action` | 999px |
| Field radius | `--hp-radius-field` | 14px |
| Popover radius | `--hp-radius-overlay` | 16px |
| Panel radius | `--hp-radius-panel` | 20px |
| App workspace radius | `--hp-radius-workspace` | 24px |
| Spacing | `--hp-space-*` | 4 / 8 / 12 / 16 / 24 / 32 / 48px |
| Interactive / overlay motion | `--hp-motion-{interactive,overlay}` | 160ms ease / 120ms ease |

Buttons, icon buttons, chips and segmented choices use action radius. Fields,
timeline regions, lists and compact cards use field radius. Large workspaces
use panel/workspace radius. Never invent a local radius.

## Reusable primitives

| Primitive | Job |
| --- | --- |
| `ActionButton` | Text action: brand, light, secondary, danger or quiet. |
| `IconButton` | One labelled icon action with Tooltip. |
| `Field` | Label, input/control, hint and error as one unit. |
| `SegmentedControl` | Mutually exclusive, immediately applied options. |
| `MenuButton` + `Popover` | Contextual choices without persistent UI noise. |
| `StatusBadge` | Compact state, never a call to action. |
| `LockedField` | A recognised but unsupported capability and its true reason. |
| `Dialog` / `Drawer` | Focused decision / long contextual work. |

Do not implement the same anatomy per page. If a required pattern is absent,
add a primitive and documented variants before using it.

## State contract

All interactive primitives define default, hover, pressed, focus-visible,
selected, disabled and loading state. Hover changes depth or luminosity within
the same semantic family only. Focus uses a blue ring distinct from selected
border. Loading preserves the control's geometry and label width. Disabled has
no hover response.

## Product-specific rules

- Minutes use a filled blue lightning icon (`Zap` with `fill="currentColor"`)
  in a small blue carrier, followed by the numeric balance. Do not use gems.
- Canvas overlays may use `rgba(16,17,22,.72)` plus `backdrop-filter: blur`.
  Ordinary forms and cards remain opaque.
- Layout modes are selected through the contextual frame inspector. Their
  availability must come from HVE capability data, not a visual guess; a mode
  must not be shown as ready until the full analysis-and-render path exists.
- Editor uses three working zones: transcript, canvas, contextual properties;
  transport and scene timeline are one bottom dock. It is not a freeform NLE.
- Mobile editor has one bottom sheet for Text, Tools and Properties and no
  dashboard navigation.

## Required review

Use `.claude/skills/hashpix-page-verification/SKILL.md` before releasing any
page. Use `.claude/skills/hashpix-ux-research/SKILL.md` before importing a
workflow pattern from another product.
