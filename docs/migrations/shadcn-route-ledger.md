# Shadcn route ledger

| Route | Area | Legacy dependencies | Target components | Status | Checks |
| --- | --- | --- | --- | --- | --- |
| `/sign-in` | Auth | custom focus/card styling | Button, Input, Field | Canonical preset pass | stock Input focus ring; typecheck, unit: 196 pass |
| `/sign-up` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/forgot-password` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/dashboard` | Dashboard | dashboard shell and wizard | product shell, shadcn forms and overlays | Migrated | typecheck, unit: 196 pass |
| `/dashboard/new` | Dashboard | redirect only | dashboard route flow | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects` | Dashboard | raw filter tabs | Button, Input, ToggleGroup, Dialog | Canonical preset pass | filters now use registry ToggleGroup; typecheck, unit: 196 pass |
| `/dashboard/projects/[id]` | Workspace | HeroUI controls/drawer | Hashpix choices, Sheet drawer, actions | Migrated | typecheck pass; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/projects/[id]/clips/[clipId]` | Editor | legacy dashboard actions/overlays | Hashpix choices, actions and shadcn Dialog | Migrated | typecheck pass; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/styles` | Dashboard | dashboard UI controls | Hashpix choices and actions | Migrated | typecheck pass |
| `/dashboard/billing` | Dashboard | dashboard buttons | Hashpix actions and states | Migrated | typecheck pass |
| `/dashboard/account` | Dashboard | no legacy dependency | Field, LockedField, Button, status | Canonical preset pass | authenticated session QA; 2FA remains honestly locked |
| `/dashboard/help` | Dashboard | raw search input | Input and reusable states | Migrated | typecheck pass |
| `/admin` | Admin | local admin system | shadcn Button, StatusBadge | Canonical preset pass | typecheck pass |
| `/admin/users` | Admin | HeroUI/table controls | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/workspaces` | Admin | HeroUI/forms | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/jobs` | Admin | HeroUI/actions | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |
| `/admin/audit` | Admin | HeroUI/list controls | shadcn Button, Hashpix StatusBadge | Migrated | typecheck pass |

Public `/` and `/blog/**` are excluded from migration and remain mandatory regression checks.
