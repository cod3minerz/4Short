# Post-migration performance audit

Date: 2026-08-10

## Scope and method

Production measurements use `next build` plus `next start` on localhost, not
development mode. HTTP timings are local production-server measurements, so
they identify render/waterfall shape rather than field Core Web Vitals. The
in-app browser asset inventory supplied font/resource facts; its isolated page
evaluation does not expose the Performance Timeline, so FCP/LCP/CLS/INP cannot
be honestly recorded from this environment. Authenticated browser routes also
remain unavailable because the real local Better Auth credential is rejected.

## Baseline before changes

| Route | HTTP TTFB | HTML bytes | Linked JS/CSS transfer | Purpose |
| --- | ---: | ---: | ---: | --- |
| `/` | 309 ms | 41,041 | 831,772 / 654,287 B | Public landing cold render |
| `/blog` | 70 ms | 49,641 | 1,414,805 / 654,287 B | Public blog |
| `/blog/remove-silence` | 28 ms | 58,220 | — | Static article |
| `/dashboard/help` | 28 ms | 44,092 | 1,003,705 / 190,194 B | Product rich content |
| `/sign-in` | 37 ms | 13,934 | 930,988 / 126,638 B | Accessible product/auth route |
| `/dashboard/projects` | 9 ms | 44,218 | — | Product route; browser state unavailable |

Linked resource numbers are uncompressed localhost response totals, not a
substitute for production CDN compression. Static output totals were 3,894,780
B: 3,030,473 B JS, 717,843 B CSS and 146,464 B fonts. The heaviest CSS file is
the intentionally public-only HeroUI/landing stylesheet (527,649 B); it is not
changed in this pass because active public Blog components still consume HeroUI.

### Font baseline

Landing browser asset inventory observed **6 font requests**:

1. four `next/font` assets from root `Geist` and `Geist Mono` preload;
2. two public `/fonts/geist-*-wght-normal.woff2` assets from a second
   `@font-face` family named `Geist Variable`.

The extra public pair totals 44,484 B and has `Cache-Control: public, max-age=0`.
The root `next/font` pair for Geist Mono is also preloaded on every route even
though Mono is only used by code blocks in the Help Typeset boundary. The
public CSS therefore created the observable chain:

`fallback → next/font Geist → public Geist Variable`.

`next/font` already emits a metric-adjusted fallback (`Geist Fallback`), while
the public `@font-face` did not. This competing second family is the proven
font-swap/layout-shift root cause.

## Rendering and bundle findings

- Root layout performs no auth, database or fetch work; it only supplies font
  variables and `TooltipProvider`. Public `/` and Blog are static/SSG in the
  production build. The observed local landing cold TTFB is therefore startup
  cost, not a route-level data waterfall; repeat public responses are 28–70 ms.
- `DarkLanding` is the active landing client boundary. Its shader is already a
  non-SSR dynamic import, so it does not block HTML rendering. Replacing it or
  restructuring public product UX is outside this targeted pass.
- `@heroui/styles` is public-boundary-only but substantial. It cannot be
  removed safely in this pass because active Blog client components use HeroUI.
- Browser-level FCP/LCP/CLS/INP, hydration CPU and a complete request waterfall
  need a real browser Performance Timeline / field or lab runner. They remain
  explicit measurement debt rather than invented values.

## Targeted remediation

Use one canonical `next/font` Geist family throughout product and public
surfaces; remove the duplicate public `@font-face`; keep Next's automatic
metric-adjusted fallback; and stop preloading Geist Mono globally while keeping
the same family available when a code surface actually renders it. No visual
token, size, layout, public CSS or component architecture change is allowed.

## Result after remediation

The production rebuild and fresh browser visit confirm that the landing now
loads only the canonical Next-managed Geist subsets. The browser observed no
console errors and no request to `/fonts/geist-*-wght-normal.woff2`.

| Landing measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Font requests | 6 | 3 | -3 (50%) |
| Font bytes transferred | 124,652 B | 60,728 B | -63,924 B (51.3%) |
| Total browser assets | 31 | 28 | -3 |
| Next font preloads in HTML | 4 | 2 | -2 |
| Linked JS | 831,772 B / 13 files | 831,772 B / 13 files | unchanged by design |
| Linked CSS | 654,287 B / 3 files | 653,747 B / 3 files | -540 B |
| HTML | 41,041 B | 40,523 B | -518 B |

The post-change font files are the three real Geist language subsets used by
the Russian/Latin landing (14,900 B, 29,288 B and 16,540 B), all served with
`Cache-Control: public, max-age=31536000, immutable`. The third subset is
Latin-extended, not another font family. Geist Mono is no longer an initial
route preload; its generated CSS remains available to the Help code-block
boundary when it is needed.

Local `next start` timing is not a production-CWV substitute. The first landing
request after the post-change restart was 85 ms TTFB (baseline startup request:
309 ms); subsequent requests were 32 ms, 3 ms and 3 ms. This is consistent
with static response warm-up, but is deliberately not claimed as an
optimization attributable to the font patch. Browser FCP/LCP/CLS/INP and
hydration CPU remain unmeasurable in the supplied browser bridge because it
does not expose the Performance Timeline; they need a real lab/field CWV run.

### Critical-path conclusion

For the public landing the initial path is now:

`static HTML → 3 stylesheets → canonical Geist subsets → 13 JavaScript files → client hydration`.

The only removed critical-path work is the competing public font family and
global Mono preload. The largest remaining landing assets are the active
public HeroUI/landing stylesheet (527,113 B) and a 227,315 B JavaScript chunk.
They were inspected but intentionally not changed: active Blog components use
HeroUI, and neither has a proven safe targeted removal in this pass. The Blog
initial linked JavaScript total (1,414,805 B) and authenticated browser CWV
also remain follow-up measurement work.

### Verification

- `git diff --check`, `npm run typecheck`, `npm run lint`, `npm run test:unit`,
  `npm test` (199 unit + 11 SSR checks), `npm run build:vercel`,
  `npm run audit:product-ui` and `npm run audit:dark-surfaces` pass.
- The new font-delivery regression test prevents a public `@font-face`, public
  `Geist Variable`, or direct `/fonts/geist-*` reference from re-entering the
  active code path.
- Codebase Memory was reindexed and reports no active source reference to the
  removed public family outside that regression assertion.
