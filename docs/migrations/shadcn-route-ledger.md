# Shadcn route ledger

| Route | Area | Legacy dependencies | Target components | Status | Checks |
| --- | --- | --- | --- | --- | --- |
| `/sign-in` | Auth | local inputs/actions | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/sign-up` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/forgot-password` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/dashboard` | Dashboard | dashboard shell and wizard | product shell, shadcn forms and overlays | Migrated | typecheck, unit: 196 pass |
| `/dashboard/new` | Dashboard | redirect only | dashboard route flow | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects` | Dashboard | raw actions/dialog | Hashpix actions, Input, Dialog | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects/[id]` | Workspace | HeroUI controls/drawer | Select, Switch, Sheet, menus | Audited | Baseline pass |
| `/dashboard/projects/[id]/clips/[clipId]` | Editor | dashboard UI/raw controls | shared controls and HVE product components | Audited | Baseline pass |
| `/dashboard/styles` | Dashboard | dashboard UI controls | forms, Select, Switch, dialogs | Audited | Baseline pass |
| `/dashboard/billing` | Dashboard | dashboard buttons | Button, states, table | Audited | Baseline pass |
| `/dashboard/account` | Dashboard | dashboard buttons/forms | Field, Button, status | Audited | Baseline pass |
| `/dashboard/help` | Dashboard | raw search input | Input and reusable states | Audited | Baseline pass |
| `/admin` | Admin | HeroUI/local light system | shared tokens, Button, Badge | Audited | Baseline pass |
| `/admin/users` | Admin | HeroUI/table controls | Table, Select, AlertDialog | Audited | Baseline pass |
| `/admin/workspaces` | Admin | HeroUI/forms | Table, Field, Select, Dialog | Audited | Baseline pass |
| `/admin/jobs` | Admin | HeroUI/actions | Table, Badge, AlertDialog | Audited | Baseline pass |
| `/admin/audit` | Admin | HeroUI/list controls | Table, filters, Badge | Audited | Baseline pass |

Public `/` and `/blog/**` are excluded from migration and remain mandatory regression checks.
