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
3. **Shape communicates object type.** Every compact control uses the same
   14px optical corner at every height; containers are the only
   rounded-surface family. `corner-shape: squircle` is progressive polish,
   never a dependency. No local numeric radius may be introduced to "make it
   fit".
4. **State never changes meaning.** A neutral or white control may brighten,
   but it never becomes blue on hover. Blue is reserved for user media and
   explicitly configured brand assets, not application chrome.
5. **Glass shows context beneath it.** Use it over video/canvas or ambient
   media only; never as generic form decoration.
6. **Every promise is executable.** Unimplemented HVE features are locked with
   a reason, never styled as active controls.

## Token layer

Define product values once in the Hashpix product root. Component/page CSS must
consume these roles rather than create literal alternatives.

| Role | Token | Value |
| --- | --- | --- |
| Application canvas | `--hp-canvas` | `#0A0A0B` |
| Base surface | `--hp-surface` | `#121214` |
| Raised surface | `--hp-surface-raised` | `#18181B` |
| Quiet surface | `--hp-surface-subtle` | `#202024` |
| Media stage | `--hp-media` | `#09090A` |
| Border | `--hp-line` | `#2B2B30` |
| Strong border | `--hp-line-strong` | `#48484F` |
| Primary text/action | `--hp-text`, `--hp-brand` | `#F5F5F2` |
| Secondary text | `--hp-text-muted` | `#A5A5AE` |
| Tertiary text | `--hp-text-subtle` | `#777780` |
| Primary foreground | `--hp-brand-foreground` | `#0B0B0C` |
| Success | `--hp-success` | `#32C982` |
| Warning | `--hp-warning` | `#E8B34C` |
| Danger | `--hp-danger` | `#F06B73` |

Foreground tokens accompany all interactive fills. Do not derive them inside a
component. The product's primary action is neutral light on dark; no product
component may introduce a blue substitute.

## Geometry

| Role | Token | Value |
| --- | --- | --- |
| Compact / regular / large control height | `--hp-control-{sm,md,lg}` | 32 / 36 / 40px |
| Any compact control | `--hp-radius-control` | 14px |
| Surface / sheet | `--hp-radius-surface` | 18px |
| App workspace radius | `--hp-radius-workspace` | 24px |
| Spacing | `--hp-space-*` | 4 / 8 / 12 / 16 / 24 / 32 / 48px |
| Interactive / overlay motion | `--hp-motion-{interactive,overlay}` | 160ms ease / 120ms ease |

Buttons, icon buttons, chips, segmented choices and fields use the same
14px `--hp-radius-control`, regardless of their height. Cards, lists, dialogs
and media containers use `--hp-radius-surface`; only app workspaces use
`--hp-radius-workspace`. Never invent a local radius.

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
the same semantic family only. Focus uses the neutral `--hp-focus-ring`,
distinct from the selected border but never blue. Loading preserves the
control's geometry and label width. Disabled has no hover response.

## Product-specific rules

- Minutes use a filled lightning icon (`Zap` with `fill="currentColor"`) in a
  neutral light carrier, followed by the numeric balance. Do not use gems.
- Canvas overlays may use `rgba(16,17,22,.72)` plus `backdrop-filter: blur`.
  Ordinary forms and cards remain opaque.
- Layout modes are selected through the contextual frame inspector. Their
  availability must come from HVE capability data, not a visual guess; a mode
  must not be shown as ready until the full analysis-and-render path exists.
- Editor uses three working zones: transcript, canvas, contextual properties;
  transport and scene timeline are one bottom dock. It is not a freeform NLE.
- Mobile editor has one bottom sheet for Text, Tools and Properties and no
  dashboard navigation.
- A media surface may show only a retained source/result thumbnail or an
  explicit unavailable state. Never substitute a monogram, brand art, fake
  subtitle frame, score or generated-looking placeholder for user media.
- Source duration, selected in/out range, charge and remaining balance are a
  single transactional decision. The next step and analysis command remain
  unavailable until duration is known and the exact selected range is covered.
- A user-visible processing stage must be backed by a job checkpoint. Do not
  render future clips as if analysis had completed; show one honest source
  thumbnail and the current stage instead.

## Required review

Use `.claude/skills/hashpix-page-verification/SKILL.md` before releasing any
page. Use `.claude/skills/hashpix-ux-research/SKILL.md` before importing a
workflow pattern from another product.
