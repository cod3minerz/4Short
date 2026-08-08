# Shadcn UI migration inventory

Updated: 2026-08-08  
Branch: `codex/shadcn-ui-migration`  
Codebase Memory project: `Users-kirill-Documents-4Short`

| Legacy component or pattern | Current path | Known usage | Target | Risk | Status |
| --- | --- | ---: | --- | --- | --- |
| HeroUI internal imports | `app/dashboard`, `app/admin` | 11 files | shadcn/Radix primitives | High: interaction props and overlays | Audited |
| Legacy dashboard UI folder | `app/dashboard/components/ui` | 22 files | `components/ui` plus `components/hashpix` | High: shared across editor/workspace | Audited |
| Hashpix product compositions | `components/hashpix` | ActionButton, IconButton, Field, LockedField, StatusBadge | shadcn/Base UI primitives with Hashpix semantics | Medium | Established |
| Raw action buttons | Internal route components | 44 matches / 19 files | `Button`, `ActionButton`, `IconButton` | Medium | Audited |
| Raw text/form inputs | Internal route components | 24 matches / 15 files | `Input`, `Textarea`, `Field` | Medium | Audited |
| Select and switch wrappers | Dashboard/admin | 7 select matches plus 5 shared wrapper consumers | shadcn `Select`, `Switch` | High: value API changes | Audited |
| Dialog wrapper | Dashboard UI | 6 consumers | shadcn `Dialog`/`AlertDialog` | High: focus and destructive actions | Audited |
| Drawer wrapper | Dashboard UI | 2 consumers | shadcn `Sheet` | High: responsive/focus | Audited |
| Segmented choices | Wizard and workspace | repeated | shadcn `ToggleGroup`/`RadioGroup` | Medium | Audited |
| Status, empty and processing states | Dashboard shared UI | repeated | Hashpix product compositions | Medium | Audited |
| Admin light/local primitives | `app/admin` | 5 routes | shared dark tokens and shadcn controls | High | Audited |
| Auth local form controls | `app/sign-in` shared by 3 routes | one multi-step flow | shadcn form primitives | High | Audited |
| Notifications | Internal application | no toast provider found | Sonner plus retained inline field errors | Medium | Audited |
| Product CSS literals | dashboard/admin/auth CSS | 177 color-function matches | semantic shadcn/`--hp-*` tokens | High | In progress |
| Local radius declarations | dashboard/admin/auth CSS | 247 declarations | 14/18/24px semantic radius family | High | In progress |
| Public HeroUI consumers | landing and blog | 4 files | deliberately retained outside scope | Landing regression | Excluded |

The inventory is closed only when graph and source audits find no internal HeroUI import, primitive duplicate, legacy provider, or unjustified literal.

## Finalisation audit note (2026-08-08)

The residual legacy risk is concentrated in duplicate dashboard layout blocks
and `--dash-*` geometry aliases. The temporary `--hp-*` bridge has been
removed. Route components with raw controls are explicitly queued in the
migration progress document; media range inputs are excluded because they are
editor-native controls, not generic form primitives.

The old `app/admin/admin.css` cascade is removed. `app/admin/admin-minimal.css`
is now the single product-specific layout layer and resolves every visual role
through the canonical preset variables.
