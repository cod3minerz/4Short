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
