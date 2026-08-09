# Shadcn migration progress

Branch: `codex/shadcn-ui-migration`
Clean source baseline: `b110fe5`
Target UI foundation: `b37sSWfzM`

## Phase status

- [x] Phase 0 — safe preflight and current-state audit
- [x] Phase 1 — decommission active legacy instructions
- [ ] Phase 2 — target preset/theme foundation (**blocked: shadcn registry/npm network**)
- [ ] Phase 3 — canonical primitives, typography and shared compositions
- [ ] Phase 4 — product route migration
- [ ] Phase 5 — rich content, legacy cleanup and final verification

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

## Phase 1 record

- `AGENTS.md` now routes product UI work only through the b37/Vega/Hugeicons/
  Geist design-system and verification documents.
- The b38 migration master and dashboard design skill are moved to explicit
  archive locations with deprecation headers; no active instruction links to
  either file.
- Product UI, page-verification, workflow, CSS, subtitle and no-dead-ui skills
  preserve functional rules while deferring visual decisions to the current
  source of truth.
- Full Codebase Memory reindex after the instruction migration completed:
  6,698 nodes and 15,376 edges.
- See `docs/ui/instruction-inventory.md` for the full KEEP/MIGRATE/ARCHIVE
  classification and hierarchy.

## Phase 1 verification

- Active-source keyword sweep: target-standard and legacy-reference matches are
  classified in `docs/ui/instruction-inventory.md`.
- HVE production/verification, renderer, clip-format, subtitle and no-dead-ui
  rules remain active; only obsolete visual-library anatomy and paths changed.
- No production UI, theme, `components/ui` or preset file is changed in this
  phase.

Phase 3 has not started.

## Phase 2 blocker record

The exact canonical preset command was attempted three times from a clean
branch. Each attempt failed in external shadcn/npm network transport before a
foundation diff could persist. No fallback CLI version, manual preset copy or
feature workaround was used. Full evidence and follow-on impacts are in
`shadcn-phase-2-preset-audit.md`.
