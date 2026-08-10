# Shadcn/Vega final acceptance ledger

Date: 2026-08-10
Branch: `codex/shadcn-ui-migration`
Target: `b37sSWfzM` / `base-vega` / neutral / Hugeicons / Geist

## Final migration status

**ARCHITECTURALLY COMPLETE WITH BLOCKED VISUAL EVIDENCE.** Product UI has one
canonical Vega/shadcn foundation and the technical, registry and HVE gates are
complete. The remaining browser route/state matrix is not called PASS: a real
local Better Auth credential is rejected, so authenticated fixtures cannot be
safely exercised without an impermissible bypass.

## Enforced contract

`npm run audit:product-ui` runs in CI after lint. It rejects an invalid target
preset/theme/font/icon foundation; unreviewed files in `components/ui`; legacy
imports/tokens/scopes; product HeroUI/Lucide; direct raw generic controls;
manual dialogs; unapproved Typeset roots; arbitrary visual values; semantic
heading drift; and primitive geometry overrides outside the exact allowlist.
It also asserts the `dashboard-geometry.css` structural checksum and forbids
legacy/focus paint there. `npm run audit:dark-surfaces` runs beside it.

The bounded exception register is
[`docs/ui/product-ui-allowlist.md`](../ui/product-ui-allowlist.md). It covers
one native file input, two native colour inputs, exact structural admin/Help
arbitrary layout values and 16 specialised geometry compositions. It does not
contain a wildcard or a compatibility layer.

## Residual metrics

| Metric | Phase 0 / legacy baseline | Final | Classification |
| --- | ---: | ---: | --- |
| Raw product `<button>` | present legacy substitutes | 0 | Canonical Button required |
| Raw generic text controls | 12 raw inputs | 0 | Canonical Field/Input/Select/Textarea required |
| Native specialised inputs | unclassified | 3 | 1 file + 2 colour, allowlisted |
| Internal HeroUI imports | legacy migration risk | 0 | Public boundary only |
| Internal Lucide imports | 25 files | 0 | Hugeicons/AppIcon standard |
| Legacy UI imports | legacy wrappers present | 0 | ESLint + audit restricted |
| `--hp-*` / `--dash-*` / overlay scope | legacy layer present | 0 / 0 / 0 | Audit failure if reintroduced |
| Arbitrary typography/radius | 7 occurrences | 0 | No generic visual exception |
| Primitive geometry overrides | unclassified | 16 | Exact reviewed entries only |
| Duplicate generic PageHeading | dashboard-local source | 0 | Shared semantic typography only |
| Manual generic dialog/card implementation | legacy recipe risk | 0 | Registry Dialog/Card required |

The baseline mixed route/code inventory with a pre-migration CSS surface, so
the qualitative legacy counts are intentionally not manufactured as false
precise numbers. Final counts are executable gate inputs.

## Route and consistency result

The generated manifest remains 27 routes. All 16 retained product routes are
migrated at the component architecture level; `/dashboard/styles` remains
removed/404; public `/`, `/blog` and `/blog/[slug]` retain their public
implementation. The route-by-route state and browser classification remains
in [`shadcn-route-ledger.md`](shadcn-route-ledger.md).

Across product routes the source contract now has one implementation per
semantic role: registry Button/Input/Select/Card/Dialog/Sheet/Tabs/Badge and
Tooltip, shared PageHeader/SectionHeader/Typography, Hugeicons/AppIcon and
the root Vega focus/radius/theme variables. Specialist media/editor/timeline
geometry is retained only where it encodes a real workflow or renderer
contract; it is not a second control system.

## Registry, theme and instruction flow

- `components.json` declares `base-vega`, neutral CSS variables and Hugeicons.
- `components/ui` contains exactly the audited 27 registry primitive sources;
  `npx shadcn@latest diff` must report no update before release.
- `app/globals.css` owns the exact light/dark semantic maps and
  `--radius: 0.625rem`; the document root remains dark by default.
- Geist and Geist Mono load with Latin and Cyrillic subsets. Dialog/Popover
  portals inherit the root theme; `.hp-overlay-scope` is absent.
- `AGENTS.md`, active UI skills, `docs/ui/design-system.md` and
  `docs/ui/verification-protocol.md` name only b37/Vega/Hugeicons/Geist as
  product visual authority. Mira/b38 material is archive-only historical
  evidence. HVE, renderer and no-dead-ui requirements remain active behaviour
  contracts.

## Red-team result

| Attempt | Result |
| --- | --- |
| Add a standard button without registry Button | Fails architecture audit on raw `<button>`; review rules require the primitive. |
| Create a new page title with arbitrary utilities | Fails semantic heading audit outside the shared typography/approved Typeset root. |
| Import Lucide or HeroUI in product UI | Fails product-scoped ESLint and architecture audit. |
| Import archived/legacy UI | Fails product-scoped ESLint and architecture audit. |
| Add a custom raw dialog | Fails architecture audit. |
| Change primitive geometry locally | Fails unless one exact reviewed exception is added with documentation. |
| Apply Typeset to an application shell | Fails the one-root Typeset allowlist. |
| Reintroduce public styles globally | Fails the root-layout/public-boundary audit. |

These controls are deliberately scoped: native file/colour and specialist
media/timeline mechanics remain possible but must be explicit and documented.

## Browser evidence debt

The visual QA matrix for dashboard, projects, workspace, editor, billing,
account, Help and admin remains **BLOCKED WITH EXTERNAL/ENVIRONMENT REASON**.
The local server's real Better Auth development credential is rejected and no
authorized fixture can reach the required API/data states. No auth bypass,
fake production account or fabricated screenshots were introduced. Static,
SSR/build, registry and source-level accessibility evidence does not replace
that missing browser interaction evidence.

## Technical evidence

- `git diff --check` — pass.
- `npx shadcn@latest diff` — `No updates found.`
- `npm run audit:product-ui` and `npm run audit:dark-surfaces` — pass.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` — pass; 198 unit
  tests pass.
- `npm run test` — pass, including rendered HTML/SSR checks and the Vinext
  production build.
- PostgreSQL queue integration commands were invoked but safely skipped locally:
  no `HVE_TEST_DATABASE_URL`/`DATABASE_URL` is configured. They require an
  explicitly opted-in isolated test database and run as real integration tests
  in CI's PostgreSQL service; this local environment limitation is not a PASS.
- `npm run build:vercel` — pass; 27 routes generated.
- `npm run hve:smoke:g4` — pass. HVE-G3 is not applicable because Phase 10
  does not touch preview, renderer, ClipEDL, timeline or media geometry
  contracts.
- Full Codebase Memory reindex/impact audit — pass: 6,981 nodes and 16,353
  edges. Its generated persistence artifacts are not committed.

## Final acceptance checklist

- [x] One Vega preset foundation; exact theme/font/icon contract.
- [x] Registry-owned primitives verified; project components remain outside it.
- [x] Legacy product imports/tokens/scopes and duplicate primitives removed.
- [x] Semantic typography, Typeset and public boundary are enforced.
- [x] Raw-control, arbitrary-value and geometry exceptions are versioned.
- [x] `dashboard-geometry.css` is restricted to specialist structural geometry.
- [x] CI executes deterministic product/dark-surface audits.
- [x] HVE/no-dead-ui/renderer contracts retained; HVE-G4 is required by final verification.
- [x] Active agent instruction flow points only to the target product system.
- [x] Red-team audit closes reasonable legacy-return paths.
- [ ] Authenticated browser evidence matrix — blocked externally as documented above.
