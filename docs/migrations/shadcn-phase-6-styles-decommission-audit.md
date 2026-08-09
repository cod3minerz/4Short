# Phase 6 — `/dashboard/styles` decommission audit

Date: 2026-08-09
Scope: remove the user-facing style-management route only. No renderer, HVE,
database, backend route or feature route migration is in scope.

## Dependency map and decisions

| Element | Evidence | Decision |
| --- | --- | --- |
| `app/dashboard/styles/page.tsx` | sole route entrypoint for `StylesView` | REMOVE |
| `app/dashboard/components/styles-view.tsx` | sole management UI consumer | REMOVE |
| Dashboard sidebar/mobile navigation | one `/dashboard/styles` item in `primaryItems` | REMOVE; mobile slot uses existing billing navigation |
| Help, wizard and workspace links | three direct links to deleted route | REMOVE; no redirect |
| Store create/update/save/default/duplicate functions | inbound graph reaches only `StylesView` | DEAD AFTER ROUTE REMOVAL — REMOVE |
| `configFromStyle`, `simpleLayoutFromLabel`, `savingStyleId` | only support the removed client management flow | DEAD AFTER ROUTE REMOVAL — REMOVE |
| Client `createStyle` / `updateStyle` API helpers | called only through removed store save flow | DEAD AFTER ROUTE REMOVAL — REMOVE |
| `.wizard-style-options__manage` | its only JSX link was removed with the wizard management guidance | DEAD AFTER ROUTE REMOVAL — REMOVE |
| `listStyles`, `styleFromApi`, `defaultStyleId`, preview persistence | hydration and wizard/workspace selection consume them | KEEP FOR RUNTIME |
| `/v1/styles`, `/v1/styles/:styleId` | control API/style version persistence | KEEP FOR RUNTIME |
| `styleId` / `styleVersionId` contracts | wizard project creation, workspace settings, project route, pipeline and HVE materialisation | KEEP FOR RUNTIME |
| DB style models, versions, renderer/subtitle/layout behavior | downstream project and HVE consumers | KEEP FOR RUNTIME |

## Retained runtime flow

1. Store hydration calls `listStyles()` and maps each API item with
   `styleFromApi`.
2. The wizard chooses a hydrated `styleId`, derives its current preset and
   submits `styleVersionId` to `createProject`.
3. The workspace reads the same hydrated styles/default, persists selected
   `styleId` through `updateProject`, and leaves renderer contracts unchanged.
4. Project/API/pipeline/HVE layers continue to validate and materialize the
   selected `styleVersionId`.

## Deferred CSS boundary

The deleted view leaves a larger set of feature-local `.style-*` selectors in
`app/dashboard/dashboard.css`. They no longer have a JSX route consumer, but
removing that legacy feature CSS is deliberately deferred to Phase 7's
repository-wide legacy cleanup: it is not executable UI, and deleting a large
interleaved CSS region is outside this route-only decommission. The one selector
directly attached to the removed wizard management link is removed in this
phase.

## Verification evidence

- Active product source has no `/dashboard/styles` route or link and no deleted
  management symbols. The only remaining literal references are this audit,
  the migration ledger, a historical page-review record and the 404 assertion.
- `npm run test` passes: 195 unit tests and 10 rendered-HTML tests. The latter
  directly confirms a normal `404` response for `/dashboard/styles`, while
  retained projects, billing and workspace routes still respond successfully.
- `npm run typecheck`, `npm run lint`, `git diff --check`,
  `npx shadcn@latest diff` and `npm run build:vercel` pass. The production
  route table contains 27 generated routes and omits `/dashboard/styles`.
- Codebase Memory full reindex passes (933 nodes, 1,700 edges). It finds no
  `StylesPage` or `StylesView`; it still traces `listStyles → hydrate`, wizard
  `chooseStyle`/`launchProject → createProject`, and workspace
  `applyStyle → updateProject`.
- Dedicated route-level visual migration is explicitly deferred; no Phase 7
  component or page redesign is claimed here.
