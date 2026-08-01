---
name: dashboard-design-system
description: Design-system rules for app/dashboard/** (the 4Short platform, not the marketing site). Use whenever building, editing, or reviewing any dashboard/editor UI — tokens, spacing/radius scale, which primitives to use instead of raw HTML, and the anti-hardcoding checklist. Keywords: dashboard, design system, tokens, hardcode, HeroUI, primitives, dash-shell.
---

# 4Short dashboard design system

Scope: **`app/dashboard/**` only.** The marketing pages (`app/page.tsx`, `app/components/*`, `app/blog/*`) and `app/admin/**` are separate and out of scope for this skill — never edit them under this skill's authority.

## Why this exists

The dashboard used to ship with two competing stylesheets (`dashboard.css` + an uncommitted `dashboard-minimal.css`) that silently overrode ~73% of the same selectors with different hardcoded values. That is the failure mode this skill prevents from recurring: **one file, one token source, one primitive per UI pattern.**

## Typography: Manrope everywhere, no exceptions

`app/globals.css:75` sets `h1, h2 { font-family: "Ermilov", var(--font-manrope), sans-serif; }` — a decorative display font for the **marketing pages only**, which share `globals.css`. Ermilov is illegible as dense dashboard UI text and must never appear on the platform. Fixed once at `.dash-shell h1/h2, .editor-focus-shell h1/h2 { font-family: var(--font-manrope), Manrope, sans-serif; }` in `dashboard.css` — **keep this override in place**, and if you add a third dashboard root class, add it there too. Never add a literal `"Ermilov"` anywhere under `app/dashboard/**`; `grep -c Ermilov app/dashboard/dashboard.css` should stay 0.

Dashboard headings describe a task; they are not marketing headlines. Keep page H1 at 24–28 px on desktop and mobile, section headings around 17–20 px, and ordinary controls at 14 px. Never repair hierarchy by introducing 35–52 px mobile headings.

## Token architecture

- `app/globals.css` `:root` — shared with the **marketing site**. Defines `--accent`, `--ink`, `--muted`, `--line`, `--surface`, `--radius-card`, `--radius-section`, fonts. **Never add dashboard-only tokens here** — anything added to `:root` leaks into the marketing pages.
- `app/dashboard/dashboard.css` `.dash-shell` rule — the dashboard's own scoped token layer. Two kinds of tokens live here:
  1. `--dash-*` prefixed tokens (`--dash-surface`, `--dash-border`, `--dash-control-{sm,md,lg}`, `--dash-radius-control`, `--dash-radius-card`, `--dash-text-muted`) — the dashboard's internal density/spacing scale.
  2. HeroUI's own unprefixed contract (`--surface`, `--surface-secondary`, `--accent-foreground`, `--field-background`, `--radius`, `--border`, `--success`/`--warning`/`--danger`, etc.) — HeroUI v3 has **no Provider** (that's a v2 pattern — verify against the `heroui-react` skill before assuming otherwise). It themes purely from these CSS custom properties. Every one of them is mapped onto a `--dash-*` token here, so hand-rolled and HeroUI components always render identically. **When you add a new HeroUI component to the dashboard, check this block first** — if it reads a variable that isn't mapped yet, add the mapping here rather than letting it fall back to HeroUI's own default palette.

## The scale (use it, don't invent new values)

| Token | Value | Use for |
|---|---|---|
| `--dash-control-sm/md/lg` | 32/36/40px | button/input/select heights |
| `--dash-radius-xs/sm/md/lg/xl` | 8/10/12/16/22px | the whole radius scale |
| `--dash-radius-pill` | 999px | fully-rounded chips and pills |
| `--dash-radius-control` / `-card` | aliases of `sm` / `lg` | semantic aliases, prefer these when the meaning is "a control" or "a panel" |
| `--dash-text-muted` / `-soft` / `-dim` / `-faint` | greys, strongest → lightest (actual order is `soft` > `dim` > `muted` > `faint` by measured contrast — `muted`/`dim` are close enough to be a wash, not a real problem) | secondary text, in decreasing emphasis |
| `--dash-border` / `--dash-border-strong` | hairlines | borders |
| `--dash-surface` / `-subtle` / `-muted` | surface elevation steps | backgrounds |
| `--dash-accent-ink` / `-wash` / `-faint` | accent text / accent backgrounds | accent-tinted UI |
| `--dash-success-*`, `--dash-danger-*`, `--dash-warning-*` | `-ink` + `-surface` pairs | status colours |
| `--dash-brand-youtube` | brand red | the one place a brand colour is legitimately hardcoded |

The radius scale replaced 20+ unrelated one-off pixel values. When a design needs a
radius, pick the nearest step — do not introduce a 21st value.

Primary brand buttons use the accent background with **white foreground**. Keep `--accent-foreground` mapped to white and verify disabled/hover/focus states instead of allowing HeroUI's default dark foreground to leak in. Filter chips and segmented choices retain the same pill/control radius in both selected and unselected states; selection may change colour or border, never the underlying shape.

Working pages use one dominant white work surface on the grey application background. Inside it, prefer spacing, headings and hairlines over nested bordered cards. Cards are reserved for genuinely independent objects (projects, presets, media choices), not every group of settings.

**Minor, low-priority note (E-AUDIT pass):** measured WCAG contrast ratio against
white for the four grey text tokens:

| Token | Hex | Contrast vs white | Uses in dashboard.css |
|---|---|---|---|
| `--dash-text-faint` | `#8a929a` | 3.15:1 — below the 4.5:1 AA floor for normal text (passes the 3:1 large-text floor) | 8 |
| `--dash-text-muted` | `#737b86` | 4.28:1 — just under the 4.5:1 AA floor | 76 |
| `--dash-text-dim` | `#657279` | 4.96:1 — passes AA | 6 |
| `--dash-text-soft` | `#536168` | 6.41:1 — passes AA comfortably | 9 |

`muted` (the most-used by far) sits close to but just under the AA floor — a minor
shortfall, not a dramatic one, and not worth a token-wide value change on its own.
Mention only if contrast is raised as a real concern; not something to proactively
"fix" — first attempt at this measurement had an off-by-one hex-parsing bug and
overstated it as a 2.6:1 failure, so double-check any contrast math here from
scratch (sanity-check the formula against `contrast('#000000','#ffffff') === 21`)
before trusting a result — it's easy to get quietly and confidently wrong.

If a spot needs a color/radius/spacing value not on this list, that is a signal to either reuse the nearest token or add a new named token to `.dash-shell` — **never drop in a bare hex/px literal**. `grep -c "#[0-9a-f]\{3,6\}" app/dashboard/dashboard.css` should trend toward zero over time, not grow.

## HeroUI compound components: use the library's own sub-parts, never a raw element with a matching `slot`

HeroUI v3's compound components (`Disclosure`, `Select`, `Modal`, `Drawer`, ...) wire up react-aria's press/context behavior through their own exported sub-components (`Disclosure.Trigger`, `HeroSelect.Trigger`, ...) — each is a real react-aria `Button` that calls `useContextProps`/`useButton` to pick up the slotted props (`buttonProps`, keyboard handling, `data-*` state) the parent injects via React context.

**A plain `<button slot="trigger">` does NOT work**, even though it looks identical and even carries the right `slot` attribute — a native DOM element never calls `useContextProps`, so it never receives the parent's press handlers. The result: the button renders, looks interactive, shows a hover/focus ring from CSS, but clicking it does **nothing** — no state change, no error, easy to ship unnoticed. `app/dashboard/components/ui/PanelSection.tsx` shipped exactly this bug (`<button slot="trigger">` instead of `Disclosure.Trigger`): all 8 accordion sections in the clip editor's right panel were permanently stuck at their default expand state — click-to-expand silently did nothing, which is especially bad here since 5 of those 8 sections default to *collapsed* (Заголовок/Баннер/Логотип/Качество рендера/Для соцсетей), making their settings unreachable. Fixed by swapping in `Disclosure.Trigger`.

Before shipping any hand-assembled HeroUI compound-component anatomy, check `node_modules/@heroui/react/dist/components/<name>/<name>.d.ts` for the sub-components it exports and use those, not a raw element with a `slot`/`data-slot` guess.

**Verification for this class of bug must be a real click that checks `data-expanded`/equivalent state before and after** — reading the JSX, or even a synthetic `element.click()`/dispatched-event call, is not enough on its own to prove a react-aria press handler is wired up; a coordinate or `ref`-based click through the browser tool, checked against actual DOM state in a separate follow-up read, is what actually catches this.

**A red herring to avoid chasing:** the console warning `"A PressResponder was rendered without a pressable child"` looks like it should point at this exact bug, but in this codebase it doesn't — it fires globally on every dashboard route because HeroUI's `ModalRoot` (`Modal`/`Drawer`) *always* wraps its children in react-aria's `DialogTrigger`, which always renders a `PressResponder`, regardless of whether a `Modal.Trigger` is actually used. `app/dashboard/components/ui/Dialog.tsx` and `Drawer.tsx` are both used in fully-controlled mode (`isOpen`/`onOpenChange` props, no `Modal.Trigger` rendered), so that `PressResponder` never gets a pressable child to register — harmless, unrelated console noise, present on every page regardless of PanelSection. Don't use this warning's presence/absence as a signal for whether a *different* press-handling bug is fixed; check the actual element and its actual state instead.

## Use these primitives — never hand-roll their equivalent

Location: `app/dashboard/components/ui/`. Before writing a `<select>`, a button-array-with-`is-active`-classes, a `<div role="dialog">`, a colored status pill, or a bordered container from scratch, check here first:

- `SegmentedControl` — wraps HeroUI `ToggleButtonGroup`. Replaces hand-rolled `wizard-segmented`/`dash-filter-row`/button-grid patterns.
- `Select` — wraps HeroUI `Select`. Replaces every raw `<select>`. Options are `{ id, label }`, and it needs an `aria-label`.
- `Switch` — wraps HeroUI `Switch`. The hand-rolled `DashboardSwitch` is deleted; do not resurrect it.
- `StatusBadge` — wraps HeroUI `Chip`. `tone` is `neutral | accent | success | warning | danger`. Replaces `dash-status.tone-*` pills.
- `Dialog` — wraps HeroUI `Modal`, **centred**. For short, focused decisions (confirmations, pickers).
- `Drawer` — wraps HeroUI `Drawer`, **side panel**. For long scrollable content that should not cover the page behind it (transcript, project settings). Choosing `Dialog` for these is a downgrade — a centred modal hides the list the panel refers to.
- `ColorField` — wraps the native colour input with a swatch plus the readable hex. Replaces raw `<input type="color">`.
- `MediaThumb` — the one video-thumbnail container. Replaced three incompatible versions, one of which (`tone-soft`) had no matching CSS and rendered nothing.
- `RangeTimeline` — dual-handle trim timeline. Bounds come from real media duration, never hardcoded seconds.
- `SubtitlePreviewOverlay` — the single subtitle preview for the wizard, the styles page and the clip editor. Renders real per-preset treatments and animates the active word. **Never hand-roll a fourth caption preview** — that is exactly how the three previously drifted out of sync.

If a primitive doesn't exist yet for a pattern you need, **build it in `ui/` and use it**, don't hand-roll a fourth one-off version.

**Before naming a new component's root className, grep it against HeroUI's own shipped classes**: `grep -o '\.your-candidate-name[a-zA-Z_-]*' node_modules/@heroui/styles/dist/heroui.min.css`. `ColorField` was originally built as `.color-field`, which collides with HeroUI's own `colorFieldVariants` (`.color-field { display:flex; flex-direction:column; ... }`, shipped in the same stylesheet). It happened to render correctly only because `dashboard.css` loads after `@heroui/styles` in the current chunk order — a load-order accident, not a guarantee. Fixed by renaming to `dash-color-field`. Prefer a `dash-` prefix for any new component root class that isn't deliberately re-skinning a HeroUI-generated class (see below).

The one legitimate exception: `.button--primary/-outline/-tertiary` etc. in `dashboard.css` deliberately target HeroUI `Button`'s own variant classes to re-skin its colors/sizing — that's intentional piggybacking, not a naming collision, and is fine to keep doing for Button specifically.

## Anti-hardcoding checklist (run before calling any dashboard page "done")

1. `grep` the touched file(s) for literal hex colors and arbitrary px values — every one should be a `var(--dash-*)` or a HeroUI semantic token, or have a one-line comment explaining why not.
2. Every interactive control is a shared primitive or HeroUI component — no bare `<select>`/`<input type="color">`/hand-toggled button array.
3. Every button has a real `onClick`/`onPress` handler or doesn't exist — no visually-live, functionally-dead buttons.
4. No literal user data (names, emails, avatar initials) hardcoded in JSX — source it from state/props, even if that state is currently a mock.
5. `next build`, `tsc --noEmit` and `eslint app/dashboard` all clean.
6. **When you delete a wrapper element, grep for CSS scoped to it.** Rules like
   `.wizard-source-dialog .wizard-source-library { grid-template-columns: 1fr; }`
   silently stop applying and the content inside reflows badly. This broke the
   layout three separate times during the Dialog/Drawer migration; each time it
   was only caught by taking a screenshot, never by reading the diff.
