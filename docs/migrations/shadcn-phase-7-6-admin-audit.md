# Phase 7.6 — Admin Vega migration audit

Date: 2026-08-10
Scope: `/admin`, `/admin/users`, `/admin/workspaces`, `/admin/jobs`, `/admin/audit`

## Architecture result

`app/admin/layout.tsx` now mounts the persistent client `AdminShell`. It owns
the single `adminApi.me()` / `adminApi.overview()` bootstrap, the existing
navigation and the mobile Sidebar Sheet. Route pages mount only their matching
data view. This prevents the shell and access gate from remounting on a normal
admin route transition; API endpoints remain the authority for every read and
mutation.

## Targeted classification

| Existing element | Classification | Phase 7.6 result |
| --- | --- | --- |
| `AdminConsole` access/shell/bootstrap | MOVE TO PERSISTENT LAYOUT | Replaced by `AdminShell` in `app/admin/layout.tsx`. |
| Overview/users/workspaces/jobs/audit regions | KEEP AS ADMIN PRODUCT STRUCTURE | Split only along the existing five route boundaries. |
| Manual metric, panel and workspace surfaces | REPLACE WITH PRIMITIVE | Registry `Card` anatomy. |
| Manual data tables | REPLACE WITH PRIMITIVE | Registry `Table` anatomy; columns, pagination and actions retained. |
| Local title/search header, empty/loading helpers | REPLACE WITH SHARED COMPOSITION | `PageHeader`, `EmptyState`, `Skeleton`. |
| Search, selects and mutation controls | REPLACE WITH PRIMITIVE | Vega `Input`, `Select`, `Button` / `AsyncButton`. |
| Suspend user / cancel job | REPLACE WITH PRIMITIVE | Canonical destructive `AlertDialog`; server mutation and permissions unchanged. |
| Mobile sidebar/backdrop | REPLACE WITH PRIMITIVE | Registry `Sidebar` with its canonical `Sheet` behaviour. |
| Lucide imports | REMOVE AS LEGACY VISUAL CODE | Replaced in the whole admin scope by Hugeicons through `AppIcon`. |
| `admin-minimal.css` | REMOVE AS LEGACY VISUAL CODE | Deleted: paint, type, radii, focus and responsive table/card CSS now resolve through primitives/Tailwind semantic roles. |
| Per-route data state reload | KEEP AS ADMIN PRODUCT STRUCTURE | Route views fetch their existing endpoint and preserve Enter-to-search/page semantics. |
| Detail drawers, row sheets, audit-specific filters | DEFER | No existing API/interaction requires them; Phase 7.6 does not invent workflows. |

## Preserved contracts

- `adminApi` request paths, payloads and idempotency keys are unchanged.
- The backend keeps admin authorization. The client bootstrap only decides what
  to render after its real `/v1/admin/me` response; it is not a security gate.
- Existing permissions still disable role, user-status, plan, minutes and job
  controls. No admin bypass, fake session or demo data was added.
- Users, workspaces, jobs and audit retain route paths, headings, columns,
  Enter-to-search, pagination and mutation semantics.

## Required browser evidence

Static implementation cannot prove authenticated control actions. The current
local Better Auth development credential is rejected, so the admin matrix is
**BLOCKED** pending a reproducible authorized local session and data fixture:
successful access, denied access, route transition without gate flash, empty/
loading/error/populated states, filters, paging, confirmations, Escape/focus
return, 360/768/1024/1440 widths and console/overflow inspection.

Phase 7.6's full Codebase Memory reindex completed successfully (6,903 nodes,
16,159 edges); the graph confirms all five route pages call the shared
`AdminRouteView`. The earlier Phase 7.4/7.5 reindex debt is historical and is
not retroactively reclassified by this separate fresh result. Generated graph
artifacts are intentionally not committed.
