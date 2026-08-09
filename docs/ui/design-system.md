# Hashpix product UI design system

## Canonical source of truth

The product UI target is shadcn preset `b37sSWfzM`: **Vega**, **Hugeicons** and
**Geist**. This document is the active visual contract for sign-in, dashboard,
editor, admin and product overlays.

Precedence for product UI decisions:

1. this document;
2. `docs/ui/verification-protocol.md`;
3. the target preset and registry primitives in `components/ui`;
4. feature behaviour and safety rules (`no-dead-ui`, HVE/renderer/contract docs);
5. archived migration material, strictly as historical reference.

`components.json` and the complete canonical primitive set are the applied
target foundation from Phases 2 and 4. Phase 3 establishes the exact semantic
maps, root dark default and font variables. Current feature CSS, feature components and archived
b38/Mira records are not permission to recreate or extend the legacy visual
system; they remain migration debt until their assigned phases.

## Foundation contract

- Apply `b37sSWfzM` only in its assigned foundation phase; never hand-copy its
  theme, component anatomy or visual recipes beforehand.
- `components/ui` is the only canonical primitive location. Use registry
  primitives and their public APIs instead of visual imitations in route code.
- `components/hashpix` may compose real behaviour (loading, locked capability,
  media state, domain status), but cannot own a parallel primitive or token
  system.
- Use target semantic roles (`background`, `foreground`, `card`, `popover`,
  `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`,
  `ring`, `sidebar`, chart roles and `radius`) rather than local colours,
  shadow recipes, radius scales, `--hp-*` or `--dash-*` aliases.
- Vega governs the target component geometry. Do not add component-specific
  height, padding, radius or focus overrides merely to approximate old UI.
- The exact target `:root` and `.dark` semantic maps live in `app/globals.css`.
  `--radius` is exactly `0.625rem`; the document root keeps `.dark` for the
  current product default. Do not introduce aliases such as `--hp-*` or
  `--dash-*` into the product foundation.
- Dialog, Popover and other Base UI portals inherit the root theme. Do not add
  a portal theme bridge, scope wrapper or local overlay geometry override.
- Hugeicons is the product icon standard. New product code must not add Lucide
  as a second icon language; existing imports are migrated in the component
  phase.
- The installed minimal primitive set is `AlertDialog`, `Badge`, `Button`,
  `Card`, `Checkbox`, `Dialog`, `DropdownMenu`, `Field`, `Input`, `InputOTP`,
  `Label`, `Popover`, `Progress`, `ScrollArea`, `Select`, `Separator`, `Sheet`,
  `Sidebar`, `Skeleton`, `Slider`, `Switch`, `Table`, `Tabs`, `Textarea`,
  `Toggle`, `ToggleGroup` and `Tooltip`. Their generated sources are
  registry-owned; do not locally amend their visual anatomy.
- `TooltipProvider` is mounted at the application root. `SidebarProvider` is
  mounted only with the first real Sidebar consumer, rather than pre-wrapping
  product routes in unused provider infrastructure.

## Typography

Application UI uses `--font-geist`; monospace content uses `--font-geist-mono`.
Both are loaded by `next/font/google` with Latin and Cyrillic subsets. Rich content is
an opt-in `typeset` surface for Markdown/MDX/documentation only, never for
ordinary dashboard controls or dense editor UI.

| Semantic role | Target utility direction |
| --- | --- |
| Page title | `text-2xl font-semibold tracking-tight` |
| Section title | `text-lg font-semibold` |
| Card title | `text-base font-semibold` |
| Body / label | `text-sm` / `text-sm font-medium` |
| Muted / caption | semantic `text-muted-foreground`; use `text-xs` only for true metadata |

One semantic role must use one scale across product routes. Arbitrary text
sizes, local font families and route-specific typography recipes require an
explicit semantic exception recorded in review evidence.

## Component and interaction rules

- Use `Button`, `Input`, `Card`, `Dialog`, `DropdownMenu`, `Select`, `Tabs`,
  `Table`, `Sidebar` and other registry primitives once installed; do not
  recreate their anatomy with raw tags and utility classes.
- Use ordinary React/shadcn APIs (`onClick`, `disabled`, compound overlay APIs).
  Do not add compatibility props for retired UI libraries.
- A control either performs a verified action or is a truthful `LockedField`.
  HVE and renderer capability contracts override a desired visual treatment.
- An icon-only control has an accessible name and a tooltip. Overlay focus,
  Escape/outside behaviour and return focus are part of its contract.
- Product pages preserve Hashpix workflow architecture; adopting the preset
  does not turn the editor into a generic dashboard or change business/API/HVE
  behaviour.

## Boundaries

Public landing and blog are regression control surfaces and do not inherit the
product UI migration. Their HeroUI styles, preserved marketing typography and
local public font faces enter only through `app/public-boundary.css`, mounted
by `/` and `/blog/**`; never import those styles from `app/globals.css` or a
product route. `docs/archive/legacy-ui-instructions/` and
`docs/migrations/archive/` are not active instruction sources and must never
be needed to implement new UI.
