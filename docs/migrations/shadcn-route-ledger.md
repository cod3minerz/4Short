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
| `/sign-in` | Auth | migrated Phase 7.1 | 360/1440 browser: default, focus, error, password reveal, keyboard and no overflow | Complete — Better Auth behaviour retained |
| `/sign-up` | Auth | migrated Phase 7.1 | 768 browser: validation and real local signup to OTP | Complete — Better Auth behaviour retained |
| `/forgot-password` | Auth | migrated Phase 7.1 | 1024 browser: validation and reset-password transition | Complete — Better Auth behaviour retained |
| `/dashboard` | Source wizard | migrated canonical controls; original shell/frame/stepper/footer retained | 1280×720 authenticated: empty and URL-error states, profile Escape/focus return, no horizontal/nested scroll | Browser matrix blocked: confirmed/processing and 360/768/1024/1440 still required |
| `/dashboard/new` | Redirect/entry flow | entry remains routed to the retained source wizard | implementation/static audit | Pending browser redirect check with `/dashboard` matrix |
| `/dashboard/projects` | Projects | migrated canonical controls; original project-list/table retained | 1280×720 authenticated: loading then empty/storage, ToggleGroup/search and no horizontal/nested scroll | Browser matrix blocked: populated/failed/delete dialog and 360/768/1024/1440 still required |
| `/dashboard/projects/[id]` | Workspace | migrated Phase 7.3 without IA redesign | preview `podcast-24`: tabs, Sheets, Select/Switch, transcript search, Escape/focus return and no overflow at 360/768/1024/1440 | Blocked: real loading/error/permission/processing/ready/failed, transcript persistence, render/download/polling and screenshot evidence require live fixtures |
| `/dashboard/projects/[id]/clips/[clipId]` | Clip editor | migrated Phase 7.4 without workspace/mechanics redesign | static audit; HVE-G4 PASS; initial populated DOM at 1280 had no horizontal overflow | Blocked: local authenticated fixture/session expired; loading/error/ready, toolbar/dialog, preview/timeline, keyboard/focus, console and 360/768/1024/1440 browser evidence remain required |
| `/dashboard/styles` | Styles management | removed in Phase 6 | direct route returns Not Found; no navigation or internal product links remain | Removed — domain remains consumed by wizard/workspace |
| `/dashboard/billing` | Billing | canonical billing surfaces; payment/ledger contracts preserved | static audit and pre-redirect browser DOM; authenticated browser interaction blocked | Implementation complete; full browser matrix blocked by rejected local session |
| `/dashboard/account` | Account | canonical identity/security; real Better Auth contracts retained | static audit; authenticated session/dialog/sign-out browser evidence blocked | Implementation complete; full browser matrix blocked by rejected local session |
| `/dashboard/help` | Help | canonical application-help shell plus one Help-only Typeset documentation article | static audit; route redirect prevented browser interaction | Implementation complete; full browser matrix blocked by rejected local session; Phase 8 rich-content boundary is static-documentation only |
| `/admin` | Admin shell | persistent Vega Sidebar and real access bootstrap | static contract audit; authenticated browser evidence blocked | Implementation complete; browser matrix blocked |
| `/admin/users` | Admin | canonical table, role/status actions and confirmation | static contract audit; authenticated browser evidence blocked | Implementation complete; browser matrix blocked |
| `/admin/workspaces` | Admin | canonical workspace Cards, plan and minutes controls | static contract audit; authenticated browser evidence blocked | Implementation complete; browser matrix blocked |
| `/admin/jobs` | Admin | canonical task table, retry/cancel actions and confirmation | static contract audit; authenticated browser evidence blocked | Implementation complete; browser matrix blocked |
| `/admin/audit` | Admin | canonical audit log and search/pagination | static contract audit; authenticated browser evidence blocked | Implementation complete; browser matrix blocked |

Public controls (`/`, `/blog`, `/blog/[slug]`) remain out of scope and are
mandatory regression surfaces. Phase 0 browser evidence is desktop-only and
representative; responsive, keyboard, overlay, error, empty and dynamic-media
matrices are explicitly deferred to their assigned migration phases.

## Phase 8 Typeset state

`/dashboard/help` is the sole product `typeset` consumer: its discrete semantic
documentation article uses `typeset typeset-help max-w-[42em]`. Page headers, search,
guide Cards, support action and the dashboard shell remain application UI and are
outside the boundary. Public Blog keeps its independent `.article-prose` MDX surface;
there is no Typeset public use. The Help browser matrix remains blocked by the rejected
local session and is not closed by static coverage.

## Phase 9 legacy-cleanup state

Phase 9 made no route, API, interaction or HVE behaviour change. It removed
only zero-consumer Hashpix compatibility/composition sources and generic
dashboard primitive paint, while retaining the route-scoped shell, wizard and
specialist editor/media geometry under `app/dashboard/dashboard-geometry.css`.
All browser QA debt from Phases 7 and 8 remains **BLOCKED**: this static cleanup
does not provide authenticated responsive, interaction, focus or console
evidence for any route.

## Phase 10 final route state

The build manifest contains 27 routes. The 16 retained product routes in the
table above are implementation-migrated and covered by the final static,
registry, lint/type/unit/SSR/build and HVE-G4 gates. `/dashboard/styles` is
intentionally removed and verified as a normal 404. Public `/`, `/blog` and
`/blog/[slug]` are unchanged public-boundary regression surfaces.

Route-level browser evidence remains exactly as classified in the table:
auth flows retain their recorded real browser checks; the dashboard, workspace,
editor, billing/account/help and five admin routes remain **BLOCKED WITH
EXTERNAL/ENVIRONMENT REASON** where authenticated state fixtures are required.
The local Better Auth test credential is rejected, so no final browser PASS,
console/overflow or accessibility interaction claim is added without real
evidence. See `shadcn-final-acceptance.md` for the complete final gate.
