# Phase 0 — safe preflight baseline evidence

## Repository safety

The preflight started from migration commit `b110fe5` with five uncommitted
files: two Codebase Memory artifacts plus the dashboard wizard CSS/component
experiment. The exact source diff was committed to recovery branch
`codex/shadcn-ui-preflight-backup` as `f46add3` before the migration branch was
restored. No visual source change from that branch has been copied back.

## Codebase Memory

A persistent full index of the clean source baseline completed successfully:

| Metric | Value |
| --- | ---: |
| Nodes | 6,669 |
| Edges | 15,347 |
| Excluded directories | 16 |

The generated graph artifacts are versioned with the Phase 0 evidence commit.
The MCP service reports the full graph counts above; its persisted artifact
metadata separately reports an extracted subset (443 nodes / 822 edges). The
binary artifact is preserved, but only the live MCP graph counts are used as
the Phase 0 index-completeness evidence.

## Browser baseline

Local browser checks at 1280×720 used the existing authenticated development
session where applicable. All listed screens had zero observed console errors
and no horizontal overflow.

| Route | Document height | Interactive count | Notes |
| --- | ---: | --- | --- |
| `/dashboard` | 897 px | 6 buttons, 2 inputs | vertical scroll is part of the current baseline |
| `/dashboard/projects` | 730 px | 7 buttons, 1 input | listing/filter baseline |
| `/dashboard/account` | 976 px | 3 buttons | security/account baseline |
| `/admin` | 720 px | 3 buttons | admin shell baseline |
| `/sign-in` | 720 px | 3 buttons, 2 inputs | auth form baseline |

These captures establish current behaviour only. They do not certify target
visual compliance, responsive states, focus states, overlays, media flows, or
HVE evidence.

## Static observations for later phases

- `components.json` currently declares base-mira with neutral/Lucide/CSS
  variables; this differs from the approved `b37sSWfzM` target.
- `components/ui` has 21 primitives but lacks Card, Checkbox, Tabs, Slider,
  InputOTP and Sidebar.
- Product CSS totals 9,644 lines across global/dashboard/admin/auth/type
  layers. It is the dominant source of non-preset geometry.
- 25 internal files import Lucide; 12 raw inputs and 7 arbitrary text/radius
  usages remain. Those are audit leads, not automatic violations.
- No internal HeroUI imports were found. Public landing/blog remain the
  regression control and are outside the product migration.

## Explicit non-actions

Phase 0 did not run shadcn `apply`, change visual tokens, add primitives,
rewrite instructions, alter routes, or migrate any page. The old b38 rules are
preserved for safety and will be formally decommissioned only by Phase 1.
