# Phase 8 — canonical shadcn/typeset audit

Date: 2026-08-10
Scope: rich-content typography only. No Phase 9 cleanup or feature-route redesign.

## Actual rich-content surface map

| Surface | Actual renderer / boundary | Decision | Reason |
| --- | --- | --- | --- |
| Dashboard Help | `app/dashboard/help/page.tsx` `<article className="typeset typeset-help max-w-[42em]">` | APPLY | A small, semantic documentation-only guide drawn from the existing source → moments → processing workflow. Search, guide Cards, support Button and PageHeader remain outside it. |
| Public Blog | MDX `Content` in `app/blog/[slug]/page.tsx` under `.article-prose` | KEEP SEPARATE | Public marketing/editorial implementation is an explicit regression boundary; no Typeset class or public CSS change. |
| Application UI | dashboard, editor, admin, auth, billing and account controls | NOT APPLICABLE | These are application UI typography and remain governed by Phase 5 semantic roles and registry primitives. |
| JSON-LD scripts | public landing/blog `dangerouslySetInnerHTML` | NOT RICH CONTENT | Structured metadata only, not rendered prose. |

The scan found MDX only in the public Blog registry. It found no `react-markdown`,
`Streamdown`, CMS rich-content renderer, or rendered Markdown surface in the product
application. This differs from the initial expectation that Help already had a rich
renderer: it had only interactive Cards and search. The isolated Help article is the
only newly approved rich-content boundary; it does not wrap or alter those controls.

## Existing typography classification

| Source | Classification | Action |
| --- | --- | --- |
| Previous short `app/typeset.css` rule set | REMOVE | Replaced wholesale with the supplied canonical shadcn/typeset source. |
| Help page heading, search, Card and button typography | KEEP | Application UI, deliberately outside `.typeset`. |
| Help custom Markdown/prose CSS | NOT APPLICABLE | No such source selector or renderer existed. |
| Public `.article-prose` in `app/public-boundary.css` | KEEP | Public-only implementation; no change and no Typeset overlay. |

## Canonical boundary

- `app/globals.css` imports `./typeset.css` exactly once, immediately after Tailwind.
- `app/typeset.css` is the complete supplied canonical implementation.
  `app/globals.css` defines the only project preset, `.typeset-help`: Geist
  body/heading, Geist Mono, `16px`, `1.6` leading and `1em` flow.
- `.typeset` is opt-in; it is not present on a body, main, shell, Card, Dialog,
  form, navigation or public Blog surface.
- The Help article contains no embedded application widget. If a future document
  embeds one, use the canonical `not-typeset` or `data-not-typeset` boundary rather
  than a global exception.

## Verification fixture

`tests/unit/typeset-boundary.test.ts` holds an isolated non-production fixture for
the heading levels, nested lists, links, inline/block code, blockquote, divider and
table types that current Help copy does not need to publish. The test also locks the
canonical selectors, Help-only use, single import, preset font variables and Blog
isolation.

## Browser evidence

Authenticated Help browser review remains blocked by the known rejected local Better
Auth test credential. The local server SSR response confirms the Help boundary and the
Blog response confirms `.article-prose` without `.typeset`, including Geist/Geist Mono
font assets. The browser-control connection itself only produced an inert `about:blank`
tab despite that reachable local server, so no visual, viewport, overflow, focus or
console browser claim is made for either surface. This Phase does not reclassify any
Phase 7 browser debt as verified.

## Codebase Memory impact audit

Full reindex completed with 6,919 nodes and 16,173 edges. The Help route remains
connected to its existing registry Cards, Input, Buttons and shared semantic
compositions; the rich-content article adds no API call, state or feature-control
dependency. The graph has exactly the Help Typeset root, the global preset definition
and the separate Blog `.article-prose` renderer in application source.
