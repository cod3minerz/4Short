# Hashpix: review sheet for a product page

Use this sheet for every changed authenticated product route before it is
described as ready. The companion procedures are
[`docs/ui/verification-protocol.md`](../ui/verification-protocol.md) and
[`.claude/skills/hashpix-page-verification/SKILL.md`](../../.claude/skills/hashpix-page-verification/SKILL.md).

## Scope

- Route:
- User role and data state:
- Change under review:
- Commit or local diff:
- Reviewer and date:

## Required state matrix

| State | Verified | Evidence / blocker |
| --- | --- | --- |
| Initial / empty |  |  |
| Loading |  |  |
| Success / populated |  |  |
| Failure / retry |  |  |
| Permission boundary |  |  |
| Long text / many items |  |  |

## Responsive matrix

| Width | No horizontal scroll | Controls reachable | Primary action visible | Evidence |
| --- | --- | --- | --- | --- |
| 360 px |  |  |  |  |
| 768 px |  |  |  |  |
| 1024 px |  |  |  |  |
| 1280 px |  |  |  |  |
| 1440 px |  |  |  |  |

## Product-system check

- [ ] All forward actions use a stock shadcn `Button` or the functional
  `ActionButton` composition.
- [ ] All icon-only actions use a named shadcn button and `aria-label`.
- [ ] Choice rows use a semantic selector; they are not decorative cards.
- [ ] New controls use only canonical `b37sSWfzM` (Vega/Hugeicons/Geist)
  semantic roles; no `--hp-*`, `--dash-*`, legacy library or local primitive
  bridge is introduced.
- [ ] Primary and neutral actions use their target preset variants without
  route-level geometry, colour, typography or focus redefinition.
- [ ] No unsupported HVE capability looks executable.
- [ ] Overlay surfaces use glass only above media or an ambient canvas.

## Interaction and accessibility check

- [ ] Keyboard order is coherent; focus is visible.
- [ ] Escape closes a temporary panel and restores focus.
- [ ] Dialogs/Drawers trap and return focus.
- [ ] Status and errors have text, not only colour.
- [ ] Motion is non-blocking and reduced-motion safe.

## Release result

Choose exactly one:

- `verified` — every required state above has browser evidence.
- `blocked` — name the inaccessible state or missing environment.
- `failed` — list the defect and owner.

Do not change `blocked` to `verified` based on static code inspection alone.

---

## Historical evidence (pre-Phase 1; not target-preset acceptance)

### 2026-08-08 — source flow and style studio (historical; route removed in Phase 6)

- Routes at the time: `/dashboard`, `/dashboard/styles`. The latter was
  decommissioned in Phase 6; this record is not current route guidance.
- User/data state: real Better Auth admin session; no retained source exists in
  this local workspace.
- Change: source-mode hierarchy, local official platform marks, confirmed-source
  fact sheet structure, and a saved-style library / subtitle-only preview /
  persisted inspector split.
- Browser evidence: 360, 768, 1024 and 1440 px; for both routes
  `document.documentElement.scrollWidth === innerWidth`; no console errors.
- Interaction: source mode selections are semantic buttons; the forward action
  is disabled before a verified source; styles select an existing saved style
  and expose its persisted controls. The preview intentionally contains no
  invented media.
- Result: `blocked` only for the real source-confirmed browser state; it cannot
  be created without uploading or importing actual user video.

---

## 2026-08-09 — Phase 7.1 auth wave

- Routes: `/sign-in`, `/sign-up`, `/forgot-password`; anonymous local Better
  Auth surface with one disposable `@hashpix.local` development account.
- States exercised: sign-in default/focus/invalid/reveal; sign-up
  default/invalid/real OTP transition; OTP partial, complete, incorrect and
  resend cooldown; forgot-password default/invalid/submitted/reset-password.
- Responsive: 360, 768, 1024 and 1440 px; every inspected route had
  `document.documentElement.scrollWidth === innerWidth`. Card width was 328px
  at 360px and 448px at wider viewports.
- Accessibility: Field labels name every input; error is an alert and is
  referenced by active fields; password reveal is named, pressable and has a
  Tooltip; OTP accepts one-time-code input; keyboard-visible Vega focus ring
  was inspected. No console errors occurred.
- System: registry Card/Field/Input/InputOTP/Button/Tooltip and Phase 5
  `AsyncButton`, `AppIcon`, typography only; no raw auth controls, local focus
  paint, Lucide import or auth stylesheet remains.
- Result: `verified`. The controller is faster than a browser-frame capture,
  so transient loading is deterministically verified by the auth unit test
  (`aria-busy`, disabled canonical `h-9` Button) rather than a screenshot.

---

## 2026-08-09 — Phase 7.2 dashboard/source/projects wave

- Routes: `/dashboard`, `/dashboard/new` entry and `/dashboard/projects`;
  authenticated local Better Auth admin at 1280×720.
- Source checks: source type Buttons expose selected state; malformed URL keeps
  the existing textual supported-platform error; source frame has
  `min-height: 0`, `overflow-y: visible`, no nested scroll and no horizontal
  document overflow. Profile `DropdownMenu` opened, closed with Escape and
  returned focus to its trigger.
- Projects checks: loading progressed to real empty/storage state; search and
  ToggleGroup changed state, and no horizontal/nested scroll was observed.
- System: Buttons, DropdownMenu, Field/Input, ToggleGroup, Card, Dialog,
  Progress, Skeleton, EmptyState, StatusBadge and Hugeicons/AppIcon were used
  without reimplementing the dashboard shell or projects information
  architecture. The native file input is the source-upload exception.
- Result: `blocked`. This browser connection provides only a 1280×720 viewport;
  no 360/768/1024/1440 evidence can be captured. The local admin has no actual
  verified, processing, ready or failed project, so source-confirmed/
  processing, populated/deletion-dialog and error/retry matrices remain open.
  These are evidence gaps, not a static-code PASS.

---

## 2026-08-10 — Phase 7.3 Project Workspace wave

- Route: `/dashboard/projects/podcast-24`; local test-admin preview project.
- System: registry Tabs/Card/Field/Select/Switch/Sheet and Button
  compositions; `AppIcon`/Hugeicons and semantic Page/Section/Card typography.
  No workspace `ActionButton`, Choice-control, drawer wrapper or direct Lucide
  source remains.
- Interaction: both tabs change their active panel; settings Sheet opens with
  real Select/Switch state, closes with Escape and returns focus to its
  trigger; transcript Sheet exposes the named search Input and returns focus
  to its trigger on Escape. The locked per-moment layout remains unavailable
  with its real backend reason.
- Responsive: browser viewport overrides at 360/768/1024/1440 all report
  `scrollWidth === innerWidth`; the 360px settings Sheet is full viewport
  width. A fresh tab after route hot-reload had no captured console errors.
- Result: `blocked`. This environment has preview/demo project data only. Real
  API loading/error/permission/processing/ready/failed states, real transcript
  mutation, render/download/polling, destructive confirmation (not present on
  this route) and retained screenshot evidence remain open. Phase 7.2 debts
  are not reclassified by this record.
