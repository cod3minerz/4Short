# Shadcn route ledger — Phase 0 baseline

Date: 2026-08-09
Baseline: `b110fe5`
Target: `b37sSWfzM`; Vega preset foundation, Phase 3 theme/public boundary and
Phase 4 canonical primitive set are applied, but no product routes have been
migrated.

Foundation note: canonical `h-9` Button/Input geometry and registry primitive
anatomy, exact semantic maps, root Geist fonts and the complete minimal
primitive set are now installed. Every product route remains pending responsive and
interaction verification in its assigned migration phase; this foundation-only
change does not close any product route ledger entry. Public `/` and `/blog/**`
are preserved regression controls behind their own HeroUI/marketing boundary.

Phase 5 note: semantic typography, header/action, empty/locked/status and
Hugeicons composition foundations now exist in `components/hashpix`. No route
has been rewritten to consume them, so this does not alter any route status or
count as browser completion evidence.

| Route | Surface | Baseline state | Phase 0 evidence | Future migration status |
| --- | --- | --- | --- | --- |
| `/sign-in` | Auth | custom auth composition | desktop browser capture; 2 inputs, 3 buttons, no console error | Pending |
| `/sign-up` | Auth | shared auth flow | static audit | Pending |
| `/forgot-password` | Auth | shared auth flow | static audit | Pending |
| `/dashboard` | Source wizard | dashboard shell + wizard/stepper | 1280×720: 6 buttons, 2 inputs, vertical scroll only, no console error | Pending; do not restore recovery diff automatically |
| `/dashboard/new` | Redirect/entry flow | dashboard entry | static audit | Pending |
| `/dashboard/projects` | Projects | listing, filters, search | 1280×720: 7 buttons, 1 input, no horizontal overflow or console error | Pending |
| `/dashboard/projects/[id]` | Workspace | project workspace | static audit; dynamic evidence pending | Pending |
| `/dashboard/projects/[id]/clips/[clipId]` | Clip editor | HVE/editor surface | static audit; HVE evidence pending | Pending |
| `/dashboard/styles` | Styles management | removed in Phase 6 | direct route returns Not Found; no navigation or internal product links remain | Removed — domain remains consumed by wizard/workspace |
| `/dashboard/billing` | Billing | account/billing surface | static audit | Pending |
| `/dashboard/account` | Account | sessions/security surface | 1280×720: 3 buttons, no inputs, no console error | Pending |
| `/dashboard/help` | Help | documentation/help surface | static audit | Pending |
| `/admin` | Admin shell | admin dashboard | 1280×720: 3 buttons, no horizontal overflow or console error | Pending |
| `/admin/users` | Admin | user management | static audit | Pending |
| `/admin/workspaces` | Admin | workspace management | static audit | Pending |
| `/admin/jobs` | Admin | job management | static audit | Pending |
| `/admin/audit` | Admin | audit log | static audit | Pending |

Public controls (`/`, `/blog`, `/blog/[slug]`) remain out of scope and are
mandatory regression surfaces. Phase 0 browser evidence is desktop-only and
representative; responsive, keyboard, overlay, error, empty and dynamic-media
matrices are explicitly deferred to their assigned migration phases.
