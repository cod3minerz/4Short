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
- [x] Legacy visual-token retirement (`--hp-*`, `--dash-*`, `--ink` and `--white` product bridges removed)
- [ ] Full automated and browser acceptance

## Active finalisation queue

1. Add the global Sonner registry primitive when the package registry is
   reachable; retain inline field and autosave feedback by design.
2. Complete the remaining authenticated dynamic workspace/editor and overlay
   records. The 360/768/1024/1440 layout matrix now passes for `/dashboard`,
   `/dashboard/styles`, `/dashboard/account` and `/admin`.
3. Close only the evidence tasks that the repository can actually prove:
   HVE-G4 is still a scaffold and must remain `INSUFFICIENT`, never PASS.

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
- Admin cold-load audit: access verification now keeps a full shadcn shell
  skeleton in place, rather than rendering the disruptive access-gate screen.
- Finalisation pass: wizard source cards, source-library rows and style
  choices now use the registry Button; workspace rows, transcript actions and
  drawer style choices now use registry Button/ToggleGroup/Input. The obsolete
  `app/admin/admin.css` cascade is deleted; admin is rendered exclusively by
  the full-viewport canonical token stylesheet.
- Token-retirement pass: `rg -- '--(hp|dash|ink|white)-' app/dashboard app/admin app/sign-in components`
  returns no matches. Dashboard/editor CSS now resolves directly to the canonical preset roles;
  the editor sends the contract-valid `#0a0a0b` subtitle outline rather than
  leaking a CSS variable into the render EDL. HVE-G4 remains `INSUFFICIENT`
  because the repository only provides a scaffold gate, never a false PASS.
- Component-boundary pass: all former `app/dashboard/components/ui/*`
  compositions are now imported from `components/hashpix`; the obsolete folder
  is empty and removed. Registry primitives remain exclusively in
  `components/ui`.
- Control audit: internal route JSX no longer contains raw `<button>` controls;
  profile, admin mobile controls, billing package choices, transcript words and
  editor mobile modes use registry Button/ToggleGroup. HVE-G4 remains
  `INSUFFICIENT` because no evidence corpus exists; preview geometry was not
  changed.
- Direct-token pass: the dashboard shell uses Geist and the preset roles
  directly, without a second Hashpix alias palette or radius scale. Browser QA
  confirms `/dashboard/styles` at 1280px and 360px has no horizontal overflow;
  a real `test@hashpix.local` Better Auth sign-in reaches `/dashboard/projects`.
- Registry-anatomy pass: generic dashboard Button/ToggleGroup/Select overrides
  are removed, the projects forward action is a stock primary `Button`, and
  the final Hashpix list compositions use registry `Button` with `onClick`.
  HVE-G4 returns `INSUFFICIENT` as required; no preview geometry changed.
- Internal/marketing boundary pass: product CSS no longer reads the landing
  `--ds-*` palette; those legacy variables remain landing-only so public pages
  stay visually unchanged.
- Contrast pass: billing credit value and help article headings now use the
  dark-product `foreground` role. Both mobile screens were inspected at 360px;
  a programmatic visible-text audit found no internal text resolved to the
  light-root foreground token.
- Source-flow and styles refinement: `/dashboard` now separates the real
  source modes, an exact platform support row and the verified-source facts
  from the later configuration steps. The four platform marks are local,
  official brand assets; no Lucide substitute is used for them. `/dashboard/styles`
  now has a responsive saved-style library, an honest subtitle-only preview
  (never invented video media) and the actual persisted inspector. Browser
  QA at 1440px and 360px reports no overflow or console errors. The confirmed
  source card still requires a real retained source, so it remains an evidence
  task rather than a fabricated success state.

## Structural locks

- Preserve dashboard navigation, main-container geometry and editor zones.
- Preserve all API, database, HVE document and routing contracts.
- Internal routes use the canonical `b38miVLH6` `base-mira` roles verbatim:
  `--radius: .625rem`, neutral surfaces, indigo primary and stock Base UI
  focus treatment; no product token bridge remains.
- Public landing and blog remain visually unchanged.
- Unsupported HVE capabilities remain `LockedField` controls with truthful reasons.
