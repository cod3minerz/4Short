# Product UI architecture allowlist

This is the reviewed exception register for `npm run audit:product-ui`. It is
not a list of styles that may be copied to new routes. Every entry has an
owner, category and reason; new entries require the same review plus an update
to `scripts/product-ui-allowlist.mjs`.

## Public boundary

Only `/` and `/blog/**` may use the preserved public HeroUI/Lucide
implementation. `app/public-boundary.css` is mounted by those public entries
and is the only permitted import point for `@heroui/styles` and `landing.css`.
Product roots must use Vega registry primitives and Hugeicons.

## Native controls

| Owner | Control | Category | Reason |
| --- | --- | --- | --- |
| `app/dashboard/components/new-project-wizard.tsx` | `input[type=file]` | Browser upload boundary | File selection cannot be expressed as a generic controlled text input. |
| `app/dashboard/components/clip-editor.tsx` | `input[type=color]` | Specialist editor control | Caption/overlay colour selection is a native colour-picker boundary inside registry Field anatomy. |

Media/video elements and `RangeTimeline` remain specialist mechanics rather
than generic product controls. They must not be used as precedent for raw
buttons, text inputs, selects or textareas.

## Intentional arbitrary layout values

| Owner | Value | Category | Reason |
| --- | --- | --- | --- |
| Source wizard | `max-h-[46dvh]` | Viewport-bounded source library | Keeps a long source library inside the active viewport. |
| Help documentation | `max-w-[42em]` | Rich-content measure | Canonical readable measure for the sole Typeset root. |
| Auth | `[&_img]:h-auto`, `[&_img]:w-36` | Intrinsic logo layout | Preserves the public brand image's intrinsic height and structural width. |
| Admin | documented `grid-cols-[…]` values | Metadata/form layout | Preserve existing truncation and compact responsive field/action rows. |

No arbitrary typography, radius, colour, shadow or focus values are allowed
for generic product controls.

## Primitive geometry exceptions

The audited exceptions are deliberately limited to existing product-specific
surfaces: Help grid-fill cards; workspace transcript/moment/media cards;
project storage and empty state; clip-editor notice; billing package choices;
and source-wizard source selection/upload/library/confirmed-source cards. They
are recorded as exact `file:primitive:className` entries in
`scripts/product-ui-allowlist.mjs` because their variable content or media
composition cannot use the default primitive geometry unchanged.

They may adjust layout placement only. A new exception cannot redefine a
primitive's paint, radius, font system, shadow or focus-visible treatment.

## Dashboard structural stylesheet

`app/dashboard/dashboard-geometry.css` owns only the retained shell,
responsive workflow and specialist media/editor/timeline geometry. Its exact
content checksum is intentionally stored in
`scripts/product-ui-allowlist.mjs`. This makes any geometry change a visible
review event. The stylesheet must not acquire generic Button/Input/Card/Dialog
paint, typography, semantic colour tokens, radius/shadow recipes or focus
rules.

There is no wildcard, directory-level exception or compatibility layer. If a
new product surface needs an exception, first prefer a canonical primitive or
shared semantic composition; only then add one narrow, documented entry.
