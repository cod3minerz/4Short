# Shadcn route ledger

| Route | Area | Legacy dependencies | Target components | Status | Checks |
| --- | --- | --- | --- | --- | --- |
| `/sign-in` | Auth | local inputs/actions | Button, Input, Label, Field | Audited | Baseline pass |
| `/sign-up` | Auth | shared AuthScreen | Button, Input, Label, Field | Audited | Baseline pass |
| `/forgot-password` | Auth | shared AuthScreen | Button, Input, Label, Field | Audited | Baseline pass |
| `/dashboard` | Dashboard | HeroUI + dashboard UI | product shell, wizard components | Audited | Baseline pass |
| `/dashboard/new` | Dashboard | HeroUI + dashboard UI | wizard, Dialog, form primitives | Audited | Baseline pass |
| `/dashboard/projects` | Dashboard | raw actions/dialog | Button, Input, AlertDialog | Audited | Baseline pass |
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
