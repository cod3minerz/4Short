# Shadcn migration progress

Branch: `codex/shadcn-ui-migration`
Clean source baseline: `b110fe5`
Target UI foundation: `b37sSWfzM`

## Phase status

- [x] Phase 0 — safe preflight and current-state audit
- [ ] Phase 1 — instruction cleanup and target preset/theme foundation
- [ ] Phase 2 — canonical primitives, typography and shared compositions
- [ ] Phase 3 — product route migration
- [ ] Phase 4 — rich content, legacy cleanup and final verification

## Phase 0 record

- Recovery commit: `f46add3` on `codex/shadcn-ui-preflight-backup`; it preserves
  the original wizard/stepper experiment and Codebase Memory binaries.
- Migration branch was restored to clean `b110fe5` before audit. The recovery
  diff was not replayed.
- Full Codebase Memory index completed: 6,669 nodes and 15,347 edges.
- The persisted artifact metadata records a smaller extracted subset (443/822);
  the binary is preserved and the live MCP graph is the index-completeness
  authority for this phase.
- Baseline source inventory, 17-route ledger and representative browser evidence
  were rebuilt. See `shadcn-phase-0-baseline.md`.
- Existing b38/base-mira instructions and documentation conflict with the
  approved b37 target. They are recorded as legacy guidance to be handled in
  Phase 1; Phase 0 did not edit them.

## Phase 0 verification

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run test:unit` — 196 pass
- `npm run build:vercel` — pass; 28 generated routes
- `npm run audit:product-ui` — pass (18 roles, 19 compositions), recorded as
  a legacy b38 contract check rather than target-preset acceptance evidence
- Representative desktop browser audit — no observed console errors or
  horizontal overflow on `/dashboard`, `/dashboard/projects`, `/dashboard/account`,
  `/admin`, or `/sign-in`

No Phase 1 work has been started.
