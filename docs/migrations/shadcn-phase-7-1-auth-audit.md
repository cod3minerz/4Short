# Phase 7.1 — auth migration audit

Date: 2026-08-09
Scope: `/sign-in`, `/sign-up` and `/forgot-password`, all rendered by the
shared `AuthScreen`. No dashboard, API, Better Auth, renderer or HVE change is
part of this wave.

## Before → canonical replacement

| Existing element | Classification | Phase 7.1 result |
| --- | --- | --- |
| `AuthScreen` steps, validation, API calls, redirects and cooldown timer | KEEP AS BEHAVIOR | Retained without endpoint or state-contract changes |
| legacy `auth-shell` / `auth-card` div surface | REPLACE WITH PRIMITIVE | Registry `Card`, `CardHeader`, `CardContent` |
| raw OTP text input | REPLACE WITH PRIMITIVE | Registry `InputOTP`, group and six slots with digit pattern |
| bespoke inputs, labels and feedback paint | REPLACE WITH PRIMITIVE | Registry `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `Input` |
| auth submit and resend buttons | REPLACE WITH SHARED COMPOSITION | `AsyncButton`; its disabled/`aria-busy` state retains Vega geometry |
| password toggle | REPLACE WITH PRIMITIVE | Registry ghost `Button size="icon"` in registry Tooltip, with Hugeicons and explicit name |
| Lucide auth icons | REMOVE AS LEGACY VISUAL CODE | Hugeicons through `AppIcon` |
| `app/sign-in/sign-in.css` | REMOVE AS LEGACY VISUAL CODE | Deleted; no auth-specific paint, focus, input or card geometry remains |

## Preserved auth behaviour

- Better Auth email/password sign-in and sign-up requests, privacy-preserving
  errors, verification OTP, password-reset OTP, resend, cooldown, redirects,
  session refresh and inline feedback are unchanged.
- `EMAIL_NOT_VERIFIED` still enters the verification step and starts the
  45-second resend cooldown. `InputOTP` keeps one-time-code autocomplete,
  digit filtering, keyboard flow and paste handling.
- The only test data created for QA was a disposable local
  `phase71-auth-*@hashpix.local` development account; no production account,
  API contract or data migration was touched.

## Browser and responsive evidence

| Route / state | Evidence |
| --- | --- |
| `/sign-in`, 360 | Default card, email focus, invalid-email alert and password reveal checked; card 328px within 360px viewport, `scrollWidth === innerWidth` |
| `/sign-up`, 768 | Default and invalid-email state checked; Card is 448px wide, all three fields retain canonical input geometry, no overflow |
| verification OTP, 768 | Real local signup transitioned to six-slot `InputOTP`; partial `123`, complete `000000`, incorrect-code error and disabled 45-second resend were exercised |
| `/forgot-password` and reset, 1024 | Invalid email, real reset-request success, new-password step, OTP and two password controls checked with no overflow |
| `/sign-in`, 1440 | Card width is 448px; keyboard-visible Vega focus ring inspected, no overflow |

The local controller completes requests too quickly to capture the transient
spinner in a browser frame. Its exact state is covered deterministically by
`auth-ui.test.ts`: `AsyncButton loading` renders the registry `h-9` button
disabled with `aria-busy="true"`, so busy states cannot alter control geometry.
No console errors were observed in the final auth browser session.

## Scope boundary and deferred work

- `components/ui` was not modified and remains registry-owned.
- Auth route migration is complete; dashboard, projects, account, admin,
  global dashboard CSS and the remaining legacy UI cleanup stay pending later
  Phase 7 waves. This phase does not begin Phase 7.2.
