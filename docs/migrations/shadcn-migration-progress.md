# Shadcn migration progress

Branch: `codex/shadcn-ui-migration`
Clean source baseline: `b110fe5`
Target UI foundation: `b37sSWfzM`

## Phase status

- [x] Phase 0 — safe preflight and current-state audit
- [x] Phase 1 — decommission active legacy instructions
- [x] Phase 2 — target preset/theme foundation
- [x] Phase 3 — theme, fonts and public boundary
- [x] Phase 4 — canonical primitive set
- [x] Phase 5 — typography and shared compositions
- [ ] Phase 6 — product route migration
- [ ] Phase 7 — rich content, legacy cleanup and final verification

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
- `npm run audit:product-ui` — pass; 18 preset roles, 19 shared compositions
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

## Phase 2 record

- The initial registry/npm transport blocker cleared without a fallback. The
  exact canonical command `npx shadcn@latest apply --preset b37sSWfzM` completed
  from the preserved baseline.
- `components.json` is now `base-vega`, neutral, CSS-variable based and uses
  Hugeicons. The official CLI rewrote the 17 existing affected primitives;
  unchanged registry primitives remain verified by `shadcn diff`.
- Button and Input use canonical Vega `h-9` geometry. No feature route,
  shared composition, legacy-CSS cleanup or typography migration was performed.
- Full Codebase Memory reindex completed: 6,709 nodes and 15,380 edges.
- `Card`, `Checkbox`, `Tabs`, `Slider`, `InputOTP`, and `Sidebar` are explicitly
  pending Phase 4 component work; they are neither installed nor claimed as
  Phase 2 completion.

## Phase 2 verification

- `npx shadcn@latest diff` — pass (`No updates found.`)
- `git diff --check` — pass
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run test:unit` — 196 pass
- `npm run build:vercel` — pass; 28 generated routes

## Phase 3 record

- Product root now uses the exact `b37sSWfzM` light/dark semantic maps with
  `--radius: 0.625rem`; product dark mode remains the default at the document
  root.
- `Geist` and `Geist Mono` are configured through `next/font/google` with
  Latin and Cyrillic subsets (`--font-geist` and `--font-geist-mono`).
- HeroUI styles and the preserved marketing typography now enter only through
  the public `/` and `/blog/**` boundary. Product CSS no longer imports
  HeroUI styles or exposes the former global marketing palette.
- The former `.hp-overlay-scope` portal bridge and its duplicated token and
  geometry overrides are removed. Base UI portals inherit the document theme
  through the root `.dark` class and canonical `popover` variables.
- No primitive was installed, no feature component was migrated, and no
  business, API, HVE or renderer behaviour changed.

## Phase 3 verification

- Exact light/dark map comparison — pass
- `git diff --check` — pass
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run test:unit` — pass (196 tests)
- `npm run build:vercel` — pass; public static metadata/params remain generated
- Codebase Memory full reindex — pass (6,727 nodes, 15,432 edges)
- Public browser regression evidence — landing and blog retain their respective
  dark/light visual surfaces with no observed horizontal overflow or console
  errors. The in-app browser exposed reliable 1280 desktop and 360 mobile
  evidence, but its requested 1440 viewport was capped by the host capability;
  this is a tooling limitation, not a route completion claim.
- Phase 4 gaps remain unchanged: `Card`, `Checkbox`, `Tabs`, `Slider`,
  `InputOTP` and `Sidebar` are not installed.

## Phase 4 record

- The official Vega registry added `Card`, `Checkbox`, `Tabs`, `Slider`,
  `InputOTP` and `Sidebar`; the Sidebar registry dependency
  `hooks/use-mobile.ts` was generated with it.
- `input-otp` is the only new runtime dependency. No unrequested primitive,
  feature variant, Hashpix wrapper, route consumer or feature CSS was added.
- `TooltipProvider` was already correctly mounted in `app/layout.tsx` and was
  not changed. `SidebarProvider` is intentionally not mounted: the Sidebar has
  no Phase 4 consumer and installing a root provider without one would be
  unnecessary infrastructure.
- All 27 product primitives are registry-owned and `npx shadcn@latest diff`
  reports no updates. See `shadcn-phase-4-primitive-matrix.md`.

## Phase 4 verification

- Registry parity and `git diff --check` — pass
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run test:unit` — pass (196 tests)
- `npm run build:vercel` — pass; 28 static routes
- Full Codebase Memory reindex/impact audit — pass (6,806 nodes, 15,723 edges)
- No product route is claimed as migrated or visually complete in this phase.

## Phase 5 record

- Targeted usage audit established one canonical semantic typography source:
  named Page/Section heading components plus a four-role text recipe. Registry
  `CardTitle`, `Label` and `Field` retain their own canonical roles.
- Added route-neutral `PageHeader` / `SectionHeader`, behavioural `AsyncButton`
  / `IconButton`, the minimal `AppIcon` Hugeicons contract, and structural
  `EmptyState`. They are shared foundation only; no page was migrated.
- `ActionButton` remains a documented temporary bridge for its existing seven
  consumers. Its legacy `tone` API is not available on new `AsyncButton` code
  and will be removed in the route/legacy-cleanup phases.
- `LockedField` now composes registry Field anatomy and `StatusBadge` remains a
  limited domain mapping over registry Badge. No separate `LoadingState` was
  added because registry Skeleton is sufficient.
- `ChoiceSegmented`, `HashpixDrawer`, `OptionCard`, `InfoPanel` and the unused
  legacy Hashpix `Field` are explicitly deferred; removing them requires their
  owning route migration. See the inventory and Phase 5 audit record.

## Phase 5 verification

- `npx shadcn@latest diff` — pass (`No updates found.`); `components/ui` has
  no Phase 5 diff.
- `git diff --check`, typecheck and full lint — pass.
- `npm run test:unit` — 196 pass; `npm run build:vercel` — pass, 28 generated
  routes.
- Full Codebase Memory reindex/impact audit — pass (6,847 nodes, 15,852 edges).
- No route-level visual completion is claimed because Phase 5 deliberately
  leaves feature routes untouched.
