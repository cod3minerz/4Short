# Phase 7.5 — Billing, Account and Help audit

Date: 2026-08-10  
Scope: `/dashboard/billing`, `/dashboard/account`, `/dashboard/help` only.

## Route decisions

| Surface | KEEP (product structure / contract) | REPLACE (canonical implementation) | REMOVE | DEFER |
| --- | --- | --- | --- | --- |
| Billing | balance, plan, minute packages, payment redirect and operation history | `PageHeader`, `SectionHeader`, `Card`, `Button`, `AsyncButton`, `Table`, `StatusBadge`, `Skeleton`, `EmptyState`, `LockedField`, Hugeicons | manual panels, selected-package paint, pseudo-table and Lucide | self-service plan change: no user-facing payment contract exists |
| Account | identity, sessions, `revoke-other-sessions`, sign-out and support deletion path | `PageHeader`, `SectionHeader`, `Card`, `Field`, `AlertDialog`, `AsyncButton`, `LockedField`, Hugeicons | manual session cards and account button CSS | per-session current-device marker: the list endpoint does not expose it |
| Help | guide destinations, search and mail support action | `PageHeader`, `SectionHeader`, `Input`, `Card`, `Button`, `EmptyState`, Hugeicons | local help card/search paint and `typeset` class | Markdown/rich documentation rendering is a Phase 8 candidate only |

## Verified behaviour boundaries

- Billing keeps `purchaseMinutePackage(code)`, its idempotency header and the provider `confirmationUrl` redirect. The transaction list continues to use `GET /v1/billing/transactions`; preview data is used only when the control API is not configured.
- The plan-change action is a locked statement, not a disabled fake control: the only plan mutation route is admin-only and no self-service subscription contract exists.
- Account keeps Better Auth `GET /v1/auth/list-sessions`, `POST /v1/auth/revoke-other-sessions` and `POST /v1/auth/sign-out`. The destructive session action has a canonical `AlertDialog` confirmation. Better Auth guarantees that the current session is retained, but its list response contains no current-session identity; no row is falsely labelled as the current device.
- TOTP, passkey, WebAuthn, recovery-code and two-factor endpoints/schema are absent from the application and Better Auth configuration. The only UI is an honest `LockedField`; this phase does not alter authentication.
- Help has no `typeset` root. Its current short application-copy cards are not rich content. Markdown/MDX/documentation presentation remains out of scope for Phase 8.

## Legacy CSS removed

`app/dashboard/dashboard.css` no longer contains Billing, Account or Help component paint, mobile overrides, selected-card rules, pseudo-table rules or dashboard dark-bridge selectors. Layout comes from Vega primitives and ordinary structural utilities; the shared dashboard shell is unchanged.

## Browser evidence

Static browser navigation initially rendered the new Billing route and showed its PageHeader, cards, selectable packages, locked plan-change reason and operation skeleton with no detected horizontal overflow. Before interaction, the local Better Auth session redirected to `/sign-in`. The known local development credential remains rejected, so authenticated billing purchase, account session/dialog/sign-out and Help interaction/browser matrices are **BLOCKED**, not passed. No header-based or development-auth bypass was used.

This preserves the outstanding Phase 7.4 browser debt unchanged.

## Technical verification

- `git diff --check`, `npx shadcn@latest diff`, `npm run lint` and
  `npm run typecheck` pass; the registry reports `No updates found.`
- `npm run test` passes 197 unit tests plus rendered-HTML/SSR checks.
- `npm run build:vercel`, `npm run audit:product-ui` and
  `npm run audit:dark-surfaces` pass.

## Codebase Memory

The Phase 7.5 reindex attempt was retried twice and the MCP indexing worker
crashed on an unspecified file both times. The server stayed available, so the
existing graph was used only to trace the unchanged billing/account API paths
and direct source checks verified the new calls. A successful fresh index is
still required evidence and is not represented as a pass.
