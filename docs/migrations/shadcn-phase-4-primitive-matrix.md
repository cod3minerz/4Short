# Phase 4 — canonical primitive consistency matrix

Date: 2026-08-09
Branch: `codex/shadcn-ui-migration`
Registry: `b37sSWfzM` / `base-vega`

## Scope and method

This phase installs the minimum proven primitive set and does not add a route
consumer, alter feature CSS, create a Hashpix wrapper, or migrate typography.
Every row is checked against the official registry with
`npx shadcn@latest diff`; no local compatibility source is accepted in
`components/ui`.

| Primitive | Phase 4 result | Contract checked |
| --- | --- | --- |
| Button | existing, registry-verified | variants/sizes including default `h-9`, disabled, focus-visible, loading-wrapper props remain standard |
| Input | existing, registry-verified | canonical `h-9`, disabled, invalid/error and focus-visible roles |
| Textarea | existing, registry-verified | disabled, invalid/error and focus-visible roles |
| Select | existing, registry-verified | compound trigger/content/items, disabled, invalid/error, keyboard/focus contract |
| Switch | existing, registry-verified | checked/disabled, invalid/error and focus-visible roles |
| Dialog | existing, registry-verified | compound overlay, Escape/outside/focus-return foundation and dark popover inheritance |
| AlertDialog | existing, registry-verified | destructive confirmation compound composition and focus-return foundation |
| DropdownMenu | existing, registry-verified | trigger/content/items, disabled, keyboard/Escape and root-theme inheritance |
| Popover | existing, registry-verified | trigger/content, focus and canonical popover tokens |
| Tooltip | existing, registry-verified | provider, trigger/content, disabled interaction and focus-visible relationship |
| Badge | existing, registry-verified | registry variants and semantic tone roles |
| Table | existing, registry-verified | canonical table composition and semantic foreground/border roles |
| ScrollArea | existing, registry-verified | viewport/scrollbar composition and theme roles |
| Sheet | existing, registry-verified | Dialog-based overlay composition and focus-return foundation |
| ToggleGroup | existing, registry-verified | item variants/sizes, selected/disabled and focus-visible contract |
| Separator | existing, registry-verified | horizontal/vertical semantic border role |
| Skeleton | existing, registry-verified | loading surface uses canonical muted role |
| Field | existing, registry-verified | label/control/error layout, disabled and invalid group states |
| Card | added from registry | default/small spacing, header/content/footer/action composition, semantic card surface |
| Checkbox | added from registry | checked/disabled/invalid/error/focus-visible states, Hugeicons indicator |
| Tabs | added from registry | default/line list variants, selected/disabled/focus-visible and horizontal/vertical composition |
| Slider | added from registry | controlled/uncontrolled range, disabled and focus-visible thumb states; route adoption deferred |
| InputOTP | added from registry | slot active/focus-visible, invalid/error, disabled states; no auth-flow consumer added |
| Sidebar | added from registry | provider/context, desktop/mobile composition and built-in Sheet/Tooltip integration; no root consumer added |

## Provider and dependency result

- `TooltipProvider` already wraps the application in `app/layout.tsx`; no
  additional integration is required.
- Sidebar brings its registry-local `SidebarProvider` and `hooks/use-mobile.ts`.
  It is not mounted globally because no page consumes Sidebar in this phase.
- `input-otp@^1.4.2` is the only dependency installed by the registry command.
- No Sonner, Command, Combobox or feature-specific primitive was added.

### Registry helper lint compatibility

The generated `hooks/use-mobile.ts` was adjusted only from direct initial
`setState` in an effect to `queueMicrotask(onChange)`. The current React lint
configuration rejects the generated direct call as a cascading render. This
preserves the hook's initial media-query result and subscription behaviour, is
outside `components/ui`, and makes no visual/API change to any primitive.
All `components/ui/**` sources themselves remain registry output and pass
`npx shadcn@latest diff`.

Codebase Memory reindex/impact audit passed with 6,806 nodes and 15,723 edges.

## Theme and future-consumer rules

The matrix verifies foundation contracts in both available root theme maps:
light and default dark. Actual route-level light/dark, keyboard and overlay
browser evidence belongs to the phase that adopts a primitive in a product
surface. Future route work must use the generated APIs unchanged and must not
add local geometry, typography, radius, shadow or focus overrides.

## Phase 5 handoff

Typography roles, Hashpix shared compositions and loading adapters remain
unstarted. Feature migration must also decide whether a native file, color or
video control is the genuine specialized exception; Slider adoption for range
controls is deferred to that later feature migration.
