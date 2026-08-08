# Hashpix: review sheet for a product page

Use this sheet for every changed authenticated product route before it is described as ready. The companion procedure is in [`.claude/skills/hashpix-page-verification/SKILL.md`](../../.claude/skills/hashpix-page-verification/SKILL.md).

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
- [ ] New controls use only canonical `b38miVLH6` CSS roles and
  `--radius: .625rem`; no `--hp-*` bridge is introduced.
- [ ] Primary actions use the preset indigo variant; neutral actions remain
  neutral on hover and pressed.
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
