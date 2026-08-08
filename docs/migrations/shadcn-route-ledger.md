# Shadcn route ledger

| Route | Area | Legacy dependencies | Target components | Status | Checks |
| --- | --- | --- | --- | --- | --- |
| `/sign-in` | Auth | custom focus/card styling | Button, Input, Field | Canonical preset pass | 360px browser focus QA: stock Input has one 2px ring, global outline is suppressed only on registry Input, wrapper has no shadow; Geist heading, no overflow or console errors |
| `/sign-up` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/forgot-password` | Auth | shared AuthScreen | Button, Input, Label, Field | Migrated | typecheck, unit: 196 pass |
| `/dashboard` | Dashboard | dashboard shell and wizard | Button, Input, Dialog, ActionButton, real platform assets | Canonical source-flow pass | 1280/360 browser QA: no overflow or console errors; source-mode controls work; source-confirmed state remains evidence-blocked until a real retained source is available |
| `/dashboard/new` | Dashboard | redirect only | dashboard route flow | Migrated | typecheck, unit: 196 pass |
| `/dashboard/projects` | Dashboard | none | Button, Input, ToggleGroup, Dialog | Direct canonical-preset pass | registry primary forward action and ToggleGroup; it navigates to `/dashboard` without a Base UI console warning; 360/1440 overflow check passes; no legacy modal/action selectors remain |
| `/dashboard/projects/[id]` | Workspace | raw tablist and search inputs | ToggleGroup, Input, Sheet drawer, actions | Canonical preset pass in progress | registry tabs/search; typecheck pass; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/projects/[id]/clips/[clipId]` | Editor | dynamic HVE evidence missing | registry Button, ToggleGroup, choices and shadcn Dialog | Canonical preset source pass | no raw internal or Hashpix-composition buttons; preview geometry unchanged; HVE-G4 scaffold: INSUFFICIENT |
| `/dashboard/styles` | Dashboard | none | Button, Input, Select, Switch, SubtitlePreviewOverlay | Canonical preset + preview pass | 1440/360 browser QA: saved-style library, non-fictional text preview and persisted inspector; no overflow; no local token bridge |
| `/dashboard/billing` | Dashboard | none | Hashpix actions and states | Canonical preset pass | mobile balance value uses preset `foreground`; 360px contrast QA passes |
| `/dashboard/account` | Dashboard | none | Field, LockedField, Button, status | Canonical preset pass | real Better Auth QA: menu items left-aligned; portal radius 14px; 2FA remains honestly locked |
| `/dashboard/help` | Dashboard | none | Input and reusable states | Canonical preset pass | 360px contrast QA: article headings inherit the dark-product `foreground` token |
| `/admin` | Admin | floating double CSS layout and access-gate flash | Badge, Button, Input, Select, Skeleton layout | Canonical preset pass | full viewport, zero main radius; cold-load keeps shell instead of access gate |
| `/admin/users` | Admin | native selects/status wrapper | Badge, Button, Input, Select | Canonical preset pass | client navigation does not show access gate |
| `/admin/workspaces` | Admin | native selects/status wrapper | Badge, Button, Input, Select | Canonical preset pass | client navigation does not show access gate |
| `/admin/jobs` | Admin | status wrapper | Badge, Button | Canonical preset pass | client navigation does not show access gate |
| `/admin/audit` | Admin | status wrapper | Badge, Input | Canonical preset pass | client navigation does not show access gate |

Public `/` and `/blog/**` are excluded from migration and remain mandatory regression checks.
