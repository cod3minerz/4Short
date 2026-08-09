# Hashpix product behaviour constraints

Visual decisions are governed exclusively by
[`docs/ui/design-system.md`](../ui/design-system.md). This document preserves
product behaviour that must survive the design-system migration.

## Product boundaries

- The product scope is authentication, dashboard, workspace, editor, admin and
  their overlays. Landing/blog are outside it.
- Do not change routing, API, database, ClipEDL, HVE or renderer contracts to
  accommodate a visual migration.
- A source/result media surface uses a retained user artifact or an explicit
  unavailable state—never fabricated media or output.

## Executable product rules

- Every visible action performs a real supported capability or uses
  `LockedField` with a truthful reason.
- Source duration, selected range, charge and remaining balance form one
  transactional decision. A user cannot advance until the exact range is known
  and covered.
- A user-visible processing stage maps to a real job checkpoint; never present
  future clips or made-up metrics as completed work.
- Layout availability comes from HVE capability evidence. The editor remains a
  focused workspace for transcript, canvas, contextual properties and
  transport—not a freeform NLE.
- Unsupported advanced HVE functions remain explicitly locked until their full
  analysis, preview and renderer path is implemented and verified.

Use the page-verification skill before release and UX research before importing
a workflow pattern from another product.
