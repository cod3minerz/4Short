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
- [x] Phase 7 — route implementation and legacy cleanup (authenticated browser
  evidence remains blocked; see the final acceptance ledger)
  - [x] Phase 7.1 — auth (`/sign-in`, `/sign-up`, `/forgot-password`)
  - [x] Phase 7.2 — implementation complete; final browser evidence is blocked
  - [x] Phase 7.3 — Project Workspace implementation complete; real API/state evidence remains blocked
  - [x] Phase 7.4 — Clip Editor implementation complete; authenticated browser evidence remains blocked
  - [x] Phase 7.5 — Billing, Account and Help implementation complete; authenticated browser evidence remains blocked
  - [x] Phase 7.6 — Admin implementation complete; authenticated browser evidence remains blocked
- [x] Phase 8 — rich-content Typeset boundary
- [x] Phase 9 — legacy product UI cleanup
- [x] Phase 10 — enforcement and final architecture gate

## Phase 7.6 record

- `app/admin/layout.tsx` now owns a persistent `AdminShell`: one real access
  bootstrap and sidebar survive navigation across all five admin routes.
- The former `AdminConsole` was decomposed only by existing route boundaries.
  Cards, tables, forms, empty/loading states, destructive confirmation and
  mobile navigation now use canonical Vega/shared primitives and Hugeicons.
- `admin-minimal.css` and all admin Lucide imports were removed. Server routes,
  idempotency keys, permissions, route IA and administrative workflows did not
  change.
- Browser evidence is still blocked by the rejected local Better Auth admin
  credential. A fresh Phase 7.6 Codebase Memory reindex/impact audit passed
  (6,903 nodes, 16,159 edges); historical Phase 7.4/7.5 reindex debt is not
  retroactively closed. Generated artifacts are not committed.

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

## Phase 7.3 record — Project Workspace

- Preserved the workspace header, moments/review split, transcript/settings
  sheet model, ready clips grid and media-preview geometry while replacing
  generic visual implementations with Vega `Tabs`, `Card`, `Field`, `Select`,
  `Switch`, `Sheet`, Button compositions and Hugeicons/AppIcon.
- Deleted the now-unused `HashpixDrawer`; no compatibility drawer remains.
  Moment/transcript/render/download/search/polling/update contracts are not
  changed. The unavailable per-moment layout remains an honest `LockedField`.
- Route-local visual overrides for generic tabs/cards/buttons/input/focus and
  the drawer wrapper were removed. Media geometry, responsive placement and
  specialist preview structure remain intentionally product-specific.
- See `shadcn-phase-7-3-workspace-audit.md` for full classification and debt.

## Phase 7.3 verification

- Preview browser evidence at 360/768/1024/1440 found no horizontal overflow;
  tabs, settings Select/Switch, transcript search and Escape/focus return were
  exercised. A fresh post-reload browser tab had no console errors.
- `git diff --check`, `npm run typecheck`, `npm run lint`, `npm run test:unit`
  (197 pass), `npm run test`, `npm run build:vercel`,
  `npm run audit:product-ui`, `npm run audit:dark-surfaces` and
  `npx shadcn@latest diff` — pass. The registry reports `No updates found.`
- Full Codebase Memory reindex/impact audit — pass (6,895 nodes, 16,227
  edges). Workspace-specific real-state coverage remains a test-scope debt;
  no dedicated automated test exists.
- Real API loading/error/permission/processing/ready/failed fixtures,
  transcript persistence, render/download/polling and saved screenshot
  evidence remain **blocked**; they are not claimed as checked.
- Phase 7.2 responsive/state evidence debt is preserved without modification.

## Phase 7.4 record — Clip Editor and overlays

- Preserved the editor workspace, preview/timeline/inspector placement, HVE
  document and draft semantics, ClipEDL/render/control contracts, preview
  clock and playback synchronisation, crop/layout geometry, media transforms
  and `RangeTimeline` mechanics.
- Standard editor controls now use canonical Vega `Button`, `Input`,
  `Textarea`, `Select`, `Switch`, `Slider`, `Tabs`, `ToggleGroup`, `Card`,
  `Dialog` and `Field`, with the Phase 5 `AsyncButton`, `IconButton` and
  Hugeicons `AppIcon` compositions.
- The two colour controls remain native browser colour pickers inside registry
  Field anatomy. `RangeTimeline`, media canvas/overlays, subtitle samples and
  compact timecodes remain documented specialist editor surfaces.
- Removed the last consumers of `ChoiceSelect`, `ChoiceSwitch`, `ColorField`,
  `OptionCard` and `SelectableRow`; their files and dead helper CSS are gone.
  The shared layout-icon data is now Hugeicons so editor and wizard never
  require a Lucide compatibility bridge.
- See `shadcn-phase-7-4-clip-editor-audit.md` for the classification and
  boundary evidence. No Phase 7.5 work is included.

## Phase 7.4 verification

- `git diff --check`, `npm run typecheck`, `npm run lint` and the focused
  `hve-editor-manifest` unit suite — pass.
- `npm run hve:smoke:g4` — pass. HVE-G3 is not applicable because no
  preview/render/media/timeline geometry or implementation is changed.
- `npx shadcn@latest diff`, `npm run audit:product-ui` and
  `npm run audit:dark-surfaces` — pass; the registry reports `No updates
  found.` and the product audit reports 18 preset roles / 20 compositions.
- `npm run test:unit` — 197 pass; `npm run test` — 197 unit and 11 rendered
  HTML/SSR checks pass; `npm run build:vercel` — pass with 27 routes.
- Codebase Memory full reindex/impact audit — pass (6,872 nodes, 15,900
  edges). The updated ClipEditor graph retains its critical HVE/control calls
  and has no deleted editor-helper node.
- Authenticated browser evidence is **blocked**: the route session expired and
  the documented local development credential was rejected by Better Auth.
  The only observed populated editor DOM at 1280px had no horizontal overflow
  before redirect; no editor interaction, console or responsive matrix is
  claimed as passed without a reproducible authenticated fixture.

## Phase 7.5 record — Billing, Account and Help

- Billing, Account and Help now consume the installed canonical Vega primitive
  set and Phase 5 compositions without redesigning their product information
  architecture. Route-owned Lucide imports, manual cards, pseudo-table,
  legacy status paint and route-specific Help/Account/Billing CSS are removed.
- Billing keeps the real minute-package purchase redirect and real transaction
  ledger. Self-service plan changes remain explicitly unavailable because the
  repository has no corresponding product payment contract.
- Account keeps the Better Auth identity, session-list, revoke-other-sessions
  and sign-out calls. Revoke uses a confirmed AlertDialog. No current-device
  marker is fabricated because the list API does not expose current-session
  identity. TOTP/passkey is a truthful locked field because no server contract
  exists.
- Help is an application UI surface only; the former `typeset` root was
  removed. Rich Markdown/documentation rendering is deferred to Phase 8.
- See `shadcn-phase-7-5-billing-account-help-audit.md`. No Phase 7.6 work is
  included.

## Phase 7.5 verification

- `git diff --check`, `npx shadcn@latest diff`, `npm run lint` and
  `npm run typecheck` — pass; the registry reports `No updates found.`
- `npm run test` — 197 unit tests and rendered-HTML/SSR checks pass;
  `npm run build:vercel` — pass.
- `npm run audit:product-ui` and `npm run audit:dark-surfaces` — pass.
- Authenticated browser QA is **blocked**: Billing rendered its new initial
  DOM before the local Better Auth session redirected to `/sign-in`; the
  documented development credential remains rejected. No bypass was used.
  Billing payment, Account sessions/revoke/sign-out, Help search and the
  required responsive/keyboard/dialog matrices remain evidence debt.
- Codebase Memory reindex retried twice but its indexing worker crashed on an
  unspecified file. The existing graph and direct source/API tracing were used
  only for impact review; a successful reindex remains a tooling evidence debt.
- The Phase 7.4 authenticated-browser debt remains blocked and unchanged.

## Phase 8 record — canonical Typeset

- Replaced the incomplete legacy `app/typeset.css` with the supplied full canonical
  shadcn/typeset implementation: headings through h6, inline semantics, GFM task
  lists, disclosures, code, blockquotes, dividers, footnotes, math, media, figures,
  tables, scroll wrappers and print/forced-colors behavior.
- Added the one approved `.typeset-help` preset (Geist, Geist Mono, `16px`, `1.6`,
  `1em`) and applied it only to a discrete semantic Help documentation article.
  Existing Help controls and all other application UI remain outside it.
- Preserved the public MDX Blog and its `.article-prose` unchanged. The rich-content
  audit found no product Markdown/CMS renderer; JSON-LD `dangerouslySetInnerHTML`
  occurrences are metadata, not prose surfaces.
- Added an isolated unit fixture for the semantic types current Help copy does not
  need to render. Browser access to Help remains blocked by the rejected local
  session; the browser-control bridge also yielded only an inert blank tab for public
  Blog despite a reachable local SSR server. No Phase 7 blocked evidence is
  reclassified.
- See `shadcn-phase-8-typeset-audit.md`. Phase 9 is not started.
- Codebase Memory full reindex/impact audit — pass (6,919 nodes, 16,173 edges):
  Help retains its existing controls and gains no API or behaviour dependency.

## Phase 9 record — legacy cleanup

- Deleted the zero-consumer `ActionButton`, legacy `Field` and `InfoPanel`
  Hashpix sources. The two remaining icon-only consumers now use the canonical
  `IconButton` composition over registry `Button` and `Tooltip`.
- Replaced the wizard's last `InfoPanel` use with registry `Card` content and
  an inline truthful destructive status; no source-validation, credit or HVE
  logic changed.
- Renamed the dashboard stylesheet to `dashboard-geometry.css` and removed
  generic primitive reset/paint, dead input/status/link/media-mark rules and
  unused legacy `LockedField`/`PanelSection` CSS. The retained stylesheet is
  limited to shell, responsive wizard and specialist media/editor geometry.
- Internal HeroUI and Lucide imports remain absent. Public HeroUI/Lucide and
  public Blog `.article-prose` remain in their isolated public boundary; the
  Phase 8 Help-only Typeset root is unchanged.
- The Phase 7/8 authenticated browser QA debt remains **BLOCKED** and is not
  reclassified by this static cleanup. See `shadcn-phase-9-legacy-cleanup-audit.md`.

## Phase 9 verification

- `git diff --check`, `npm run typecheck`, `npm run lint` and `npm run test:unit`
  — pass (198 unit tests).
- `npx shadcn@latest diff` — `No updates found.` `npm run audit:product-ui`
  reports 18 preset roles and 18 shared compositions; `npm run audit:dark-surfaces`
  passes for landing and the scoped dashboard geometry stylesheet.
- `npm run hve:smoke:g4` — pass. HVE-G3 is not applicable: no preview,
  renderer, timeline or HVE implementation/geometry contract changed.
- `npm run test` — 198 unit plus 11 rendered HTML/SSR checks pass; `npm run
  build:vercel` — pass with 27 routes.
- Residual scans report zero active `--hp-*`, `--dash-*`, `.hp-overlay-scope`,
  ActionButton/InfoPanel/legacy Field references, internal HeroUI imports,
  internal Lucide imports and removed styles-route class families. The only raw
  product controls are the native file input plus two editor colour inputs and
  the documented RangeTimeline reference.
- Codebase Memory full reindex/impact audit — pass (6,933 nodes, 16,176
  edges). The source wizard retains its control API, processing and analytics
  call paths; IconButton and RangeTimeline remain distinct registered
  compositions. Generated graph artifacts are not committed.

## Phase 10 record — enforcement and final gate

- `npm run audit:product-ui` is now a deterministic CI architecture gate. It
  validates the exact Vega foundation, registry-owned primitive layer, Geist
  foundation, public HeroUI boundary, semantic heading/Typeset boundaries,
  legacy-import/token absence, raw-control and arbitrary-value exceptions,
  primitive geometry exceptions and the scoped dashboard geometry checksum.
- ESLint forbids HeroUI, Lucide, archived UI, retired Hashpix compatibility
  sources and direct Base UI/Radix anatomy in dashboard, admin, auth and shared
  product compositions. Public landing/blog remain intentionally outside that
  restriction.
- `app/public-boundary.css` is the sole entry for HeroUI and landing CSS;
  `app/layout.tsx` no longer globally imports a public stylesheet. The removed
  zero-consumer dashboard `PageHeading` no longer creates a duplicate heading
  implementation.
- All remaining specialist controls and exact layout/geometry exceptions are
  versioned in `scripts/product-ui-allowlist.mjs` and explained in
  `docs/ui/product-ui-allowlist.md`; no wildcard exception exists.

## Phase 10 status

**ARCHITECTURALLY COMPLETE WITH BLOCKED VISUAL EVIDENCE.** The final technical,
registry, static architecture and HVE-G4 gates are recorded in
`shadcn-final-acceptance.md`. Authenticated browser route/state evidence from
Phases 7/8 remains blocked by the rejected real local Better Auth credential;
no bypass or fabricated production session was introduced.

## Phase 10 verification

- `git diff --check`, `npm run audit:product-ui`, `npm run audit:dark-surfaces`
  and `npx shadcn@latest diff` — pass; the registry reports `No updates found.`
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (198 pass), `npm run
  test` (198 unit + rendered HTML/SSR checks), `npm run build` and `npm run
  build:vercel` — pass. The Vercel build produces the expected 27 routes.
- Queue integration suites were safely skipped locally because no explicitly
  opted-in isolated PostgreSQL test URL is configured. CI supplies that service
  and executes the actual queue integration/load suites; the local skip is
  retained as environment evidence, not reported as a pass.
- `npm run hve:smoke:g4` — pass. HVE-G3 is not applicable: this phase changes
  enforcement, documentation and a zero-consumer heading only; it does not
  change preview, renderer, ClipEDL, timeline or media geometry contracts.
- Full Codebase Memory reindex/impact audit — pass (6,981 nodes, 16,353 edges).
  Dashboard control/API and editor/HVE graph paths remain present. Generated
  Codebase Memory artifacts are excluded from the migration commit.
