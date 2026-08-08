# Shadcn UI migration progress

Branch: `codex/shadcn-ui-migration`  
Base: `06edb53`  
Preset: `b38miVLH6` (`base-mira`, Geist, Lucide, neutral/indigo, Base UI)

## Stages

- [x] Baseline Git and build verification
- [x] Specification stored in repository
- [x] Initial graph-first inventory and 17-route ledger
- [x] Fresh Codebase Memory full index with exclusions (6,511 nodes / 15,047 edges)
- [x] Shadcn foundation and MCP configuration
- [ ] Shadcn skill installation (network retry pending)
- [x] Semantic token system
- [x] Official base primitives (20 registry components; Sonner retry remains pending)
- [x] Hashpix reusable component layer (ActionButton, IconButton, Field, LockedField, StatusBadge)
- [x] Auth routes (shared AuthScreen uses shadcn Button, Input and Label)
- [ ] Dashboard shell, wizard and projects
- [ ] Project workspace
- [ ] Clip editor
- [ ] Styles, billing, account and help
- [ ] Admin routes
- [ ] Global overlays and notifications
- [ ] Legacy removal
- [ ] Full automated and browser acceptance

## Baseline evidence

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run test:unit`: 196 pass
- `npm run build:vercel`: pass, 28 generated pages
- `npm run audit:product-ui`: pass under the pre-migration contract
- `npm run audit:dark-surfaces`: pass under the pre-migration contract

## Structural locks

- Preserve dashboard navigation, main-container geometry and editor zones.
- Preserve all API, database, HVE document and routing contracts.
- Use Geist for internal UI and the 14/18/24px Hashpix radius hierarchy.
- Public landing and blog remain visually unchanged.
- Unsupported HVE capabilities remain `LockedField` controls with truthful reasons.
