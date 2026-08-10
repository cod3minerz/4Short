# Phase 9 — legacy cleanup audit

Date: 2026-08-10
Scope: remove residual product legacy UI only. No Phase 10 work, public redesign,
route redesign, API change, HVE change or browser-debt closure is included.

## Evidence-backed decisions

| Candidate | Evidence | Decision | Result |
| --- | --- | --- | --- |
| `components/hashpix/action-button.tsx` | no `ActionButton` consumer; its two `IconButton` consumers were identified in workspace/editor | MIGRATE THEN DELETE | Consumers use canonical `IconButton` over `AsyncButton`/registry Button and Tooltip; old compatibility API deleted |
| `components/hashpix/field.tsx` | no import | DELETE | Registry `Field` is the only field anatomy |
| `components/hashpix/info-panel.tsx` | one wizard consumer; custom tone/icon surface and Lucide import | MIGRATE THEN DELETE | Replaced by registry Card content and truthful inline status; source validation/credits logic preserved |
| `/dashboard/styles` CSS | no surviving `styles-*`, `style-editor*`, `style-library*` or `style-preview*` consumer after Phase 6 route removal | DELETE | All dead route stylesheet blocks and responsive overrides removed |
| `ProgressStage` CSS | component uses registry Progress and Tailwind anatomy; no `progress-stage*` class output | DELETE | Dead CSS removed |
| `ValueBadge` custom paint | one wizard consumer; a semantic badge role | MIGRATE THEN DELETE | Composition now delegates to registry `Badge variant="secondary"`; CSS deleted |
| `dashboard.css` | before rename it was the sole dashboard stylesheet and contained live shell/wizard/editor/media selectors | KEEP STRUCTURAL, RENAME | `dashboard-geometry.css` is now the sole import and keeps only structural, responsive and specialist media/editor geometry; generic primitive paint/resets and dead classes removed |
| `RangeTimeline`, native video-file picker, two colour inputs | real trim geometry, browser file selection and editor colour controls | KEEP SPECIAL EDITOR | Documented specialised controls; no generic-input substitute is safe or appropriate |
| Tooltip/Sidebar providers | root Tooltip provider; admin is the only real Sidebar consumer | KEEP STRUCTURAL | Canonical provider infrastructure, not legacy providers |
| HeroUI and Lucide in public files | imports occur only under `app/components` and `app/blog` | KEEP PUBLIC | Needed for preserved `/` and `/blog/**`; no product import remains |
| `.hp-overlay-scope`, `--hp-*`, `--dash-*` | zero active product source occurrences | DELETE ALREADY COMPLETE | No cleanup action remains; audit script string check is a functional guard |
| Phase 7/8 browser matrix | documented local Better Auth fixture rejects the test credential | BLOCKED | No browser QA, console, responsive or interaction result is claimed by Phase 9 |

## Residual metrics

| Metric | Before Phase 9 | After Phase 9 |
| --- | ---: | ---: |
| Dashboard stylesheet path | `dashboard.css` | `dashboard-geometry.css` |
| Dashboard stylesheet lines | 5,416 | 3,312 |
| Hashpix `.tsx` compositions | 21 | 18 |
| Active product `--hp-*` / `--dash-*` / overlay scope references | 0 | 0 |
| Internal HeroUI or Lucide import files | 0 / 1 (`InfoPanel`) | 0 / 0 |
| Dead standalone styles-route selector families | present | 0 |

## Boundary retained for future work

`app/dashboard/dashboard-geometry.css` is not a component system. It retains
only product shell placement, wizard responsive layout, specialist preview,
timeline, transcript and media geometry. Registry primitives retain their
canonical anatomy. Remaining CSS literals are limited to media/subtitle
readability, preview compositing, specialist editor geometry and structural
depth; they require route-level browser evidence before any further removal.

## Verification record

- `git diff --check`, typecheck, lint and `test:unit` pass (198 tests).
- Registry diff reports `No updates found`; product and dark-surface audits
  pass; the full SSR suite (11 checks) and `build:vercel` (27 routes) pass.
- HVE-G4 passes. HVE-G3 is not applicable because no preview or renderer
  contract/geometry was changed.
- Codebase Memory full reindex reports 6,933 nodes and 16,176 edges. Impact
  tracing retains the wizard's API/processing/analytics paths.
