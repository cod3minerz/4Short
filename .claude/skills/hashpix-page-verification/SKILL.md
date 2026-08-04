---
name: hashpix-page-verification
description: Verify Hashpix dashboard, editor, admin, auth, landing, and modal/drawer pages after UI or UX changes. Use before declaring a page ready, when auditing responsive/layout defects, or when checking controls against design-system and backend rules.
---

# Hashpix Page Verification

Do not infer visual quality from source code or a green build.

## Required route matrix

Inspect the changed route plus its dependent states:

- dashboard: new source, source confirmed, processing, insufficient minutes;
- projects: loading, empty, active, ready, failed;
- project: moments, ready clips, transcript drawer, repeat-search menu;
- styles: list, edit, save error, default-style confirmation;
- billing: summary, package selection, transaction history;
- account and sign-in: default, focus, error, disabled/loading;
- editor: transcript, canvas, layout menu, subtitle properties, selected
  object, autosave, render, unavailable HVE capabilities;
- admin: overview, table, row drawer, destructive confirmation.

When an authenticated state cannot be reached locally, record it explicitly
and use a safe test account before release. Do not mark the route verified.

## Per-route checks

1. Structural: intended shell, no overflow, sensible container width, correct
   panel collapse at 360/768/1024/1440 px.
2. System: only semantic tokens, shared primitives, correct radius family,
   no accidental white surfaces, glass only over media/ambient content.
3. Interaction: click every visible actionable control; confirm an actual state
   change, API request or intentionally locked reason.
4. States: hover does not change meaning; focus is visible; pressed/loading
   does not shift layout; disabled cannot look enabled.
5. Accessibility: logical heading order, labels, aria names for icon controls,
   keyboard navigation, Escape and focus return for overlays.
6. Reliability: loading, error, empty and offline state guide the next action.

## Evidence

Start with [`docs/verification/product-page-review.md`](../../../docs/verification/product-page-review.md) for every changed route, then retain its completed evidence with the implementation or review record.

For each reviewed route record URL, viewport, authenticated state, screenshot,
computed overflow (`scrollWidth === innerWidth`), console errors, and controls
exercised. Run the relevant lint/type/build checks after browser QA.

## Stop conditions

Fail the review if any primary action is unclear, any control is dead, a bright
surface has no semantic reason, a local literal duplicates a token, text clips,
or a mobile sheet exposes desktop chrome behind it.
