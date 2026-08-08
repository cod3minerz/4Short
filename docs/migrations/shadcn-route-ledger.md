# Shadcn route ledger

| Route | Area | Legacy dependencies | Target components | Status | Checks |
| --- | --- | --- | --- | --- | --- |
| `/sign-in` | Auth | custom focus/card styling | Button, Input, Field | Canonical preset pass | stock Input focus ring verified: one 2px ring, wrapper has no shadow; no overflow |
| `/sign-up` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/forgot-password` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/dashboard` | Dashboard | dashboard shell and wizard | product shell, shadcn forms and overlays | Migrated | typecheck, unit: 196 pass |
| `/dashboard/new` | Dashboard | redirect only | dashboard route flow | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects` | Dashboard | none | Button, Input, ToggleGroup, Dialog | Direct canonical-preset pass | registry primary forward action and ToggleGroup; 360/1440 overflow check passes; no legacy modal/action selectors remain |
| `/dashboard/projects/[id]` | Workspace | raw tablist and search inputs | ToggleGroup, Input, Sheet drawer, actions | Canonical preset pass in progress | registry tabs/search; typecheck pass; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/projects/[id]/clips/[clipId]` | Editor | dynamic HVE evidence missing | registry Button, ToggleGroup, choices and shadcn Dialog | Canonical preset source pass | no raw internal or Hashpix-composition buttons; preview geometry unchanged; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/styles` | Dashboard | none | Button, Input, Select, Switch | Direct canonical-preset pass | 1280px/360px browser QA; Geist, `.625rem` radius and no horizontal overflow; no local token bridge |
| `/dashboard/billing` | Dashboard | dashboard buttons | Hashpix actions and states | Migrated | typecheck pass |
| `/dashboard/account` | Dashboard | none | Field, LockedField, Button, status | Canonical preset pass | real Better Auth QA: menu items left-aligned; portal radius 14px; 2FA remains honestly locked |
| `/dashboard/help` | Dashboard | raw search input | Input and reusable states | Migrated | typecheck pass |
| `/admin` | Admin | floating double CSS layout and access-gate flash | Badge, Button, Input, Select, Skeleton layout | Canonical preset pass | full viewport, zero main radius; cold-load keeps shell instead of access gate |
| `/admin/users` | Admin | native selects/status wrapper | Badge, Button, Input, Select | Canonical preset pass | client navigation does not show access gate |
| `/admin/workspaces` | Admin | native selects/status wrapper | Badge, Button, Input, Select | Canonical preset pass | client navigation does not show access gate |
| `/admin/jobs` | Admin | status wrapper | Badge, Button | Canonical preset pass | client navigation does not show access gate |
| `/admin/audit` | Admin | status wrapper | Badge, Input | Canonical preset pass | client navigation does not show access gate |

Public `/` and `/blog/**` are excluded from migration and remain mandatory regression checks.
