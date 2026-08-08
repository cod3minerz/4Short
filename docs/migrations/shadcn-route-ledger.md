# Shadcn route ledger

| Route | Area | Legacy dependencies | Target components | Status | Checks |
| --- | --- | --- | --- | --- | --- |
| `/sign-in` | Auth | local inputs/actions | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/sign-up` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/forgot-password` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/dashboard` | Dashboard | dashboard shell and wizard | product shell, shadcn forms and overlays | Migrated | typecheck, unit: 196 pass |
| `/dashboard/new` | Dashboard | redirect only | dashboard route flow | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects` | Dashboard | raw actions/dialog | Hashpix actions, Input, Dialog | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects/[id]` | Workspace | HeroUI controls/drawer | Hashpix choices, Sheet drawer, actions | Migrated | typecheck pass; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/projects/[id]/clips/[clipId]` | Editor | dashboard UI/raw controls | shared controls and HVE product components | Audited | Baseline pass |
| `/dashboard/styles` | Dashboard | dashboard UI controls | Hashpix choices and actions | Migrated | typecheck pass |
| `/dashboard/billing` | Dashboard | dashboard buttons | Hashpix actions and states | Migrated | typecheck pass |
| `/dashboard/account` | Dashboard | no legacy dependency | Field, Button, status | Migrated | source audit pass |
| `/dashboard/help` | Dashboard | raw search input | Input and reusable states | Migrated | typecheck pass |
| `/admin` | Admin | local admin system | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/users` | Admin | HeroUI/table controls | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/workspaces` | Admin | HeroUI/forms | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/jobs` | Admin | HeroUI/actions | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/audit` | Admin | HeroUI/list controls | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |

Public `/` and `/blog/**` are excluded from migration and remain mandatory regression checks.
