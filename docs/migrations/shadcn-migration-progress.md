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
- [x] Canonical preset reapplied with `npx shadcn@latest apply --preset b38miVLH6`
- [x] Official base primitives (20 registry components)
- [x] Hashpix reusable component layer (ActionButton, IconButton, Field, LockedField, StatusBadge)
- [x] Auth routes (shared AuthScreen uses shadcn Button, Input and Label)
- [x] Dashboard shell, wizard and projects
- [x] Project workspace (HVE-G4 scaffold reports INSUFFICIENT; no HVE contract or preview geometry changed)
- [x] Clip editor (HVE-G4 scaffold reports INSUFFICIENT; preview geometry and HVE contracts unchanged)
- [x] Styles, billing, account and help
- [x] Admin routes
- [ ] Global notifications (Sonner registry package is blocked by repeated npm `ECONNRESET`; existing inline field and autosave feedback remain intentionally inline)
- [ ] Legacy product CSS selector retirement (in progress; preset values now bridge remaining selectors)
- [ ] Full automated and browser acceptance

## Baseline evidence

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run test:unit`: 196 pass
- `npm run build:vercel`: pass, 28 generated pages
- `npm run audit:product-ui`: previous contract is superseded; it is not
  acceptance evidence for the canonical-preset pass.
- Browser QA: `/sign-in` has one stock Input ring and no wrapper ring;
  `/dashboard/projects` resolves the exact dark background, primary, border,
  input, ring and `.625rem` radius values; profile menu aligns both actions
  left and Escape returns focus to its trigger. No horizontal overflow in
  these authenticated checks.
- Canonical-pass audit: styles now uses 12px / 36px stock-control geometry and
  stacked title/help copy; admin is full-viewport with a shadcn sidebar, badge,
  select and input primitives. Client navigation `/admin` → `/admin/users`
  keeps the shell mounted and does not render the access gate.
- Overlay audit: dialog, dropdown and sheet portal roots consume the canonical
  dark preset surface/border/radius values. Product CSS dark-surface audit
  passes; the public landing stylesheet is deliberately excluded.

## Structural locks

- Preserve dashboard navigation, main-container geometry and editor zones.
- Preserve all API, database, HVE document and routing contracts.
- Internal routes use the canonical `b38miVLH6` `base-mira` roles verbatim:
  `--radius: .625rem`, neutral surfaces, indigo primary and stock Base UI
  focus treatment. A temporary CSS bridge maps residual legacy selectors to
  those exact roles while the selectors are retired.
- Public landing and blog remain visually unchanged.
- Unsupported HVE capabilities remain `LockedField` controls with truthful reasons.
