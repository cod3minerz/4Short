---
name: dashboard-ux-flows
description: Preserve Hashpix dashboard, source-to-clip and editor workflow behaviour. Use when changing product flow, state transitions, sources, credits or editor information architecture; visual decisions defer to the current product UI system.
---

# Hashpix product flow constraints

Read `docs/design/hashpix-product-system.md`, `no-dead-ui`,
`backend-capability-map`, `clip-formats` and `subtitle-styles` as applicable.
For visual or component decisions, use `docs/ui/design-system.md`; this skill
does not define tokens, typography, icons, spacing, radii or primitive anatomy.

## Source-to-clip flow

1. A user chooses upload, URL import or a previously retained source.
2. Source validation/loading is real. Once confirmed, show the real source
   facts needed to make the next decision: title, duration, charge and balance.
3. Cutting and format choices may expose only worker-backed behaviour; a
   missing capability is a truthful locked state.
4. Style selection must preserve the existing persisted contract and preview
   truthfulness; a preview never promises unverified renderer parity.
5. Processing labels and completion state must come from real job checkpoints.

## Credit, storage and deletion

- Use the unified billing summary for the balance; do not reintroduce a client
  split of entitlement and purchased minutes.
- Storage must come from the real storage API. Do not display fixed quota or a
  fabricated percentage.
- Deletion requires explicit confirmation and must describe logical recovery
  truthfully; do not promise immediate physical object deletion.

## Editor constraints

The editor remains a focused HVE workspace: transcript/semantic selection,
canvas, contextual executable properties, and transport/timeline. Do not add
a freeform NLE, generic dashboard widgets or controls whose renderer path is
not implemented. Preserve preview/render parity requirements and use the HVE
skills for media-contract changes.

## Completion evidence

Exercise the complete affected journey in the browser. Verify loading, error,
empty, permission and recovery states; ensure every mock value is isolated to
explicit offline preview and never flows into a real mutation. Record the
evidence through the current page-verification protocol.
