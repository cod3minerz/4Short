# Narezai product UI — HeroUI / Opus reference
## Authority
The approved specification is `docs/ui/opus-rebuild.md`. The October 12 references govern composition, density, radii and colors. HeroUI v3 / React Aria owns controls/interaction; Onest owns application type; Hugeicons owns product icons. HVE/API/no-dead-ui remain functional invariants.
Previous visual guidance is archived in `docs/archive/legacy-ui-instructions/vega-pre-opus/`. The rejected draft is recovery commit d8fc3f6 and cannot supply JSX/CSS.

## Tokens
Dark only. Canonical token sheet: `app/product/product.css`.
Canvas #1A1A1A; subdued surface #18181B; input #313131; secondary #27272A; raised cards #252525; primary #FAFAFA with #181818 text; body #FAFAFA; muted #A1A1AA; hairline #333333. Status colors require text/icon labels.
Control radius 8px; small field 6px; project/menu 12px; large source field 24px; avatar/icon circle 50%. Roles stay fixed across breakpoints. Normalize reference scale before comparing.
Spacing 4px base; normal text 14px/1.5; metadata 12px/1.4; page headings 24px/1.25 weight 600. Onest Latin/Cyrillic; tabular time/balance. No Bounded.

## Implementation
Import from @heroui/react; v3 compound APIs and onPress/isDisabled/isPending. Shared documented BEM recipes reproduce reference geometry. Do not fork primitives or add compatibility skins.
Domain compositions may own loading, media state, locked capability and real status. A single product portal boundary provides overlay tokens. No per-page theme bridges.
Use authentic logos, platform marks and actual media posters. Native file/color/video and specialist HVE timeline/canvas are allowed functional exceptions; generic controls use HeroUI.
Icon-only controls need accessible names/tooltips; all state families and focus handling are mandatory.

## Boundaries and verification
Landing/blog retain public styles/metadata/behavior. Product tokens must not leak there. Typeset is opt-in help rich content, never controls. Existing admin consumers are temporarily retained outside this redesign, not a second product target.
Follow verification-protocol. Build success alone is not visual/capability/media acceptance.
