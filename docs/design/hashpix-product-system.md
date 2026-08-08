# Hashpix Product System

## Scope

This system governs Hashpix product UI: sign-in, dashboard, editor, admin,
dialogs and mobile sheets. Marketing can share the brand accent but does not
inherit product surface rules.

## Principles

1. **Canvas is for work.** The clip, transcript and user decision receive the
   contrast; application chrome stays quiet.
2. **One semantic role, one preset token.** A value exists in the canonical
   shadcn preset before it exists in a component.
3. **Shape communicates object type.** Product controls inherit the
   `base-mira` preset scale from `--radius: .625rem`; surfaces derive from it.
   No local numeric radius may be introduced to "make it fit".
4. **State never changes meaning.** Indigo is the primary action, selected
   state and live-progress role. Neutral surfaces remain neutral on hover.
5. **Glass shows context beneath it.** Use it over video/canvas or ambient
   media only; never as generic form decoration.
6. **Every promise is executable.** Unimplemented HVE features are locked with
   a reason, never styled as active controls.

## Token layer

Internal routes consume the canonical `b38miVLH6` roles verbatim. There is no
Hashpix visual-token layer and no local palette: `background`, `foreground`,
`card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`,
`border`, `input`, `ring`, sidebar and chart roles. The dark product root is
the preset `.dark` definition; `--radius` is `.625rem`. Landing and blog keep
their separate marketing stylesheet.

## Reusable primitives

| Primitive | Job |
| --- | --- |
| `Button` / `Icon Button` | Registry shadcn action with its stock variants and sizes. |
| `Field` | Label, input/control, hint and error as one unit. |
| `ToggleGroup` | Mutually exclusive, immediately applied options. |
| `DropdownMenu` / `Popover` | Registry compound overlay primitives. |
| `StatusBadge` | Compact state, never a call to action. |
| `LockedField` | A recognised but unsupported capability and its true reason. |
| `Dialog` / `Drawer` | Focused decision / long contextual work; compose shadcn Dialog/Sheet. |

Do not implement the same anatomy per page or restyle a registry primitive.

## State contract

Registry primitives define default, hover, pressed, focus-visible, selected,
disabled and loading state. Use their stock ring and variants; loading preserves
the control's geometry and label width.

## Product-specific rules

- Minutes use a filled lightning icon (`Zap` with `fill="currentColor"`) in a
  white carrier with a black glyph, followed by the numeric balance. Do not
  use gems.
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
