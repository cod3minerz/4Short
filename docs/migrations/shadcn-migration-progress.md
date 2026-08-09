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
- [x] Phase 6 — remove `/dashboard/styles` management route
- [ ] Phase 7 — remaining route waves, legacy cleanup and final verification
  - [x] Phase 7.1 — auth (`/sign-in`, `/sign-up`, `/forgot-password`)
  - [ ] Phase 7.2 — implementation committed; final browser evidence is blocked

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

## Phase 6 record

- Removed only the standalone `/dashboard/styles` management route and
  `StylesView`; the styles domain remains hydrated and selectable in the
  project wizard and workspace.
- Removed the sidebar/mobile navigation item and product help/wizard/workspace
  links that led to the deleted route. Mobile navigation now uses the already
  existing billing item in that slot.
- Removed demonstrably dead client-only style-management mutations and their
  API helpers: create, update, save, duplicate and default-style assignment;
  `configFromStyle`, the inverse simple-layout helper and `savingStyleId` were
  dead only with that UI and are removed too.
- `/v1/styles`, `/v1/styles/:styleId`, database/models/versioning, `listStyles`,
  hydration, `styleId`/`styleVersionId`, wizard/workspace selection and all
  renderer/HVE contracts are retained unchanged.
- The former route-specific `.wizard-style-options__manage` selector is removed.
  The larger orphaned style-studio CSS region is explicitly deferred to Phase 7
  legacy cleanup; it has no active route or JSX consumer.
- See `shadcn-phase-6-styles-decommission-audit.md` for the dependency map and
  verification evidence. No Phase 7 work is included.

## Phase 6 verification

- Targeted route/link and deleted-management-symbol scans — pass; active
  product code has neither a `/dashboard/styles` link nor a styles management
  route.
- `git diff --check`, `npm run typecheck`, `npm run lint` and
  `npx shadcn@latest diff` — pass.
- `npm run test` — pass: 195 unit tests and 10 rendered-HTML checks, including
  a direct normal-404 assertion for `/dashboard/styles`; retained wizard
  redirect, projects, billing and workspace SSR checks remain green.
- `npm run build:vercel` — pass; its 27-route table omits `/dashboard/styles`.
- Full Codebase Memory reindex/impact audit — pass (933 nodes, 1,700 edges):
  no `StylesPage`/`StylesView`; `listStyles → hydrate`, wizard project creation
  and workspace style updates remain connected to their runtime APIs.

## Phase 7.1 record — auth

- Migrated the three auth routes through their one shared `AuthScreen` to
  registry `Card`, `Field`, `Input`, `InputOTP`, `Button`/Tooltip and Phase 5
  `AsyncButton`, `AppIcon` and semantic typography.
- Deleted `app/sign-in/sign-in.css`: its custom Card/input/button/focus/OTP
  paint is not retained. The password reveal is now a named ghost
  `Button size="icon"` with a registry Tooltip and Hugeicons.
- Better Auth endpoints, validation, redirects, OTP/resend/cooldown and inline
  error semantics are unchanged. See `shadcn-phase-7-1-auth-audit.md` for the
  before/after dependency classification and local browser evidence.

## Phase 7.1 verification

- Targeted auth unit suite — pass (4 tests), including canonical async loading
  semantics and source-level primitive/legacy-style assertions.
- Browser QA — default, focus, validation, password reveal, signup→OTP,
  partial/complete/incorrect OTP, resend cooldown, forgot/reset transition,
  keyboard focus, 360/768/1024/1440 layouts, no overflow and no console errors.
- `git diff --check`, `npx shadcn@latest diff`, `npm run typecheck` and
  `npm run lint` — pass; the registry reports `No updates found.`
- Full verification — pass: 197 unit tests, 11 rendered-HTML/SSR checks and
  `npm run build:vercel` generated all 27 routes, including the three auth
  entries.
- Codebase Memory full reindex and auth impact audit — pass; the shared
  `AuthScreen` remains connected only to its retained Better Auth actions.
  Phase 7.2 had not started at the time of that auth-only commit.

## Phase 7.2 record — dashboard shell, source flow and projects

- The existing dashboard shell, sidebar/mobile navigation, source-wizard frame
  and footer, and projects list/table architecture are retained. This wave does
  not introduce the registry Sidebar layout or a projects-card-grid redesign.
- Standard controls now use the canonical Vega primitives and Phase 5 shared
  compositions: Button, DropdownMenu, Card, Field/Input, ToggleGroup, Dialog,
  Progress, Skeleton, EmptyState, StatusBadge, AsyncButton and AppIcon.
- Touched route code uses Hugeicons; `ChoiceSegmented` had no remaining
  consumer and is removed. The editor-owned `OptionCard` and shared
  `layoutOptions` Lucide dependency remain explicitly deferred to Phase 7.4.
- Source API, validation, analytics, billing calculations and HVE/renderer
  contracts are unchanged. The source wizard has no added viewport min-height
  or nested scroll constraint.
- See `shadcn-phase-7-2-dashboard-audit.md` for classifications, reverted
  structural experiment and the route-state evidence ledger.

## Phase 7.2 verification

- 1280×720 authenticated browser checks — source empty/error, profile menu
  Escape/focus return, projects loading/empty/filter/search and no horizontal
  or nested scroll — pass.
- Full responsive/state browser acceptance is **blocked**: the attached local
  browser surface exposes only 1280×720 and the real test account has no
  project in confirmed/processing/ready/failed/delete states. Per the
  verification protocol this phase remains unchecked, not falsely complete.
- `npm run audit:product-ui` and `npm run audit:dark-surfaces` — pass after
  the product-contract verifier was corrected to assert the active root-theme
  portal inheritance contract instead of its retired b38 portal scope.
- `git diff --check`, `npx shadcn@latest diff`, typecheck, lint, full unit
  suite (197 pass) and production build (27 routes) — pass. Live Codebase
  Memory reindex/impact tracing completed; its empty persistence placeholder
  was not committed over the existing binary artifact.
