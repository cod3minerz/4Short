# Phase 3 — theme, fonts and public boundary audit

Date: 2026-08-09
Branch: `codex/shadcn-ui-migration`
Foundation: `b37sSWfzM` / `base-vega`

## Scope completed

This phase changes only the global product foundation and the public-style
boundary. It does not add primitives, migrate feature components, alter routes,
change feature CSS, replace feature icons, or change product/API/HVE behaviour.

## Canonical product map

`app/globals.css` contains the exact master-spec maps for `:root` and `.dark`:
neutral surfaces, indigo primary, canonical border/input/ring/sidebar/chart
roles, and `--radius: 0.625rem`. The document root has `.dark`, so the current
product default remains dark while the complete light map is ready for the
canonical system.

`app/layout.tsx` defines `Geist` and `Geist Mono` through `next/font/google`
with `latin` and `cyrillic` subsets. Their variables are `--font-geist` and
`--font-geist-mono`; `@theme inline` maps them to Tailwind's font roles.

## Removed foundation conflicts

- global HeroUI import;
- product-level marketing palette/layout variables (`--ds-*`, `--ink`, surface
  and Manrope ownership);
- global marketing `h1`/`h2` typography and global `:focus-visible` outline;
- `.hp-overlay-scope`, its duplicate dark map, and portal component geometry
  overrides.

These rules either competed with Vega or applied public marketing visual
decisions to product surfaces. They were moved to the public boundary where
they are required to preserve the public UI, except the overlay bridge, which
is intentionally removed so Base UI portals inherit the document theme.

## Public boundary

`app/public-boundary.css` is imported only by `app/page.tsx` and
`app/blog/layout.tsx`. It owns the preserved HeroUI import, local public Geist
Variable faces, marketing tokens, heading/focus rules and landing CSS. This
keeps `/` and `/blog/**` visually independent while product routes have no
HeroUI foundation styles or public token inheritance. No URL, metadata, static
parameters or public rendering behaviour is changed.

## Verification evidence

- exact target-variable comparison and `git diff --check` — pass;
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (196 tests) and
  `npm run build:vercel` — pass;
- browser checks cover public landing and blog before/after, product dark root,
  canonical Popover values and Cyrillic font loading;
- no `.hp-overlay-scope` reference remains; source imports of HeroUI stay in
  public components plus the public boundary only;
- requested viewport switching was constrained by the in-app browser host:
  reliable evidence was 1280 desktop and 360 mobile. No 1440 PASS is claimed;
  route-level visual QA remains a later-phase task.
- Codebase Memory reindex and impact audit — pass (6,727 nodes, 15,432 edges):
  `RootLayout` and the new `BlogLayout` are the only boundary layout additions;
  `generateMetadata` and `generateStaticParams` remain present and the browser
  resolves `/blog/remove-silence` with its unchanged article title.

## Phase 4 handoff

`Card`, `Checkbox`, `Tabs`, `Slider`, `InputOTP` and `Sidebar` remain absent
and explicitly pending Phase 4. Existing feature CSS, Lucide imports and
route-level visual inconsistencies are migration impacts, not Phase 3 work.
