# Product UI instruction inventory

Updated: 2026-08-09 — Phase 1

This inventory separates visual authority from product and renderer safety
rules. `ARCHIVE` content is historical only and must never be read to choose
new UI visuals.

| Source | Classification | Phase 1 disposition |
| --- | --- | --- |
| `AGENTS.md` | MIGRATE | Names only current UI documentation, target preset and verification flow. |
| `docs/ui/design-system.md` | MIGRATE | Canonical visual source: b37sSWfzM / Vega / Hugeicons / Geist. |
| `docs/ui/verification-protocol.md` | MIGRATE | Canonical verification source. |
| `.claude/skills/hashpix-product-ui` | MIGRATE | Defers visual decisions to canonical docs; preserves product/HVE boundaries. |
| `.claude/skills/hashpix-page-verification` | MIGRATE | Verifies the target system and real interactions. |
| `.claude/skills/dashboard-design-system` | ARCHIVE | Moved to `docs/archive/legacy-ui-instructions/`; contains retired b38/Mira/HeroUI guidance. |
| `docs/migrations/shadcn-ui-migration.md` | ARCHIVE | Moved to `docs/migrations/archive/`; historic b38 migration record. |
| `docs/design/hashpix-product-system.md` | MIGRATE | Reduced to executable product/HVE behaviour; no visual authority. |
| `docs/design/hashpix-dark-system.md` | MIGRATE | Marketing-only boundary; cannot guide product UI. |
| `.claude/skills/dashboard-ux-flows` | MIGRATE | Keeps functional source/editor flow constraints only. |
| `.claude/skills/css-regression-guard` | MIGRATE | Keeps cascade/layout safety only. |
| `.claude/skills/no-dead-ui` | MIGRATE | Keeps capability and interaction rules; removes retired library anatomy/path. |
| `.claude/skills/subtitle-styles` | MIGRATE | Keeps subtitle contract; fixes shared component path. |
| `.claude/skills/hve-production` | MIGRATE | Keeps all HVE rules; replaces stale design-skill reference. |
| `.claude/skills/hve-verification` | KEEP | HVE evidence gates are functional, non-visual rules. |
| `.claude/skills/clip-formats` | KEEP | Renderer capability table is functional. |
| `.claude/skills/backend-capability-map` | KEEP | Backend capability inventory is functional. |
| `.claude/skills/hashpix-ux-research` | KEEP | Research process has no visual system authority. |
| Global `hashpix-ui-quality-gate` | MIGRATE | Retains structural/browser gate and defers visuals to repository docs. |
| `components.json` | KEEP (baseline) | Implementation configuration; deliberately unchanged until Phase 2. |

## Active source-of-truth hierarchy

1. `docs/ui/design-system.md` — target visual system.
2. `docs/ui/verification-protocol.md` — acceptance and evidence method.
3. Target shadcn preset and `components/ui` once the foundation phase applies it.
4. Product/HVE/no-dead-ui/renderer rules — behaviour and safety only.
5. Archived records — historical reference only, never implementation input.

No active instruction authorizes b38/Mira, HeroUI product primitives, Manrope
product UI typography, Lucide as the product icon standard, or a `--hp-*` /
`--dash-*` visual layer.
