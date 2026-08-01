---
name: css-regression-guard
description: Checklist of four CSS regression classes that have each broken the 4Short dashboard at least once during this redesign. Use before and after any dashboard.css edit, especially removing a wrapper element, bulk find/replacing colors or tokens, or merging stylesheets. Keywords: CSS regression, broke the layout, dashboard.css, computed style, token substitution.
---

# CSS regression guard

Four specific, already-happened failure modes in `app/dashboard/dashboard.css`. Each was caught only by screenshotting live computed styles, never by reading the diff. Check for all four after any non-trivial CSS edit.

## 1. CSS scoped to a wrapper you just deleted

Rules like `.wizard-source-dialog .wizard-source-library { grid-template-columns: 1fr; }` silently stop applying when `.wizard-source-dialog` is removed (e.g. swapping a hand-rolled `<dialog>` for the `Dialog`/`Drawer` primitive). The content inside doesn't error — it just reflows using whatever base rule is left, usually wrong. This broke the source-library list, the clip-scope dialog, and the transcript drawer, three separate times.

**Check:** after deleting/replacing a wrapper element, `grep` the old class name across `dashboard.css`. Every remaining hit is a rule that needs re-scoping or deleting.

## 2. Regex/bulk token substitution without word boundaries

A bulk `#fff` → `var(--dash-surface)` replace matched inside `#fff7e2` and `#fff7f7`, producing `var(--dash-surface)7e2` — a syntactically-invalid declaration that CSS parsers silently drop, taking the whole rule's intended background with it.

**Check after any bulk color/token substitution:** `grep -n 'var(--[a-z-]*)[0-9a-zA-Z]' dashboard.css` — should return nothing. Also spot-check a handful of replaced declarations by reading them, not just trusting the substitution count.

## 3. Base display/layout rules lost during a merge or a later, higher-specificity rule silently winning

Grid/flex containers have ended up as `display: block` after a stylesheet merge, and a later media query (declared further down the file, same specificity) has overridden an earlier responsive fix — e.g. a `max-width: 1220px` rule declared after a `max-width: 640px` rule wins at narrow widths because source order breaks the tie, not the narrower/more-specific-sounding number.

**Check:** for any container whose layout might have moved, read the *computed* `display`/`grid-template-columns` live in the browser at the breakpoints that matter — never assume the rule you edited is the one that's actually applied. `getComputedStyle(el).gridTemplateColumns` after a real resize is the ground truth.

## 4. Two same-named classes from different libraries

`dashboard.css`'s own `.color-field` collided with HeroUI's shipped `.color-field` (`colorFieldVariants`) — both defining `display: flex; flex-direction: column`, differing in `align-items`/`gap`. It rendered correctly only by accident of import order (dashboard.css loads after `@heroui/styles`), which is not a guarantee across Next.js chunk changes.

**Check before naming any new component's root class:** `grep -o '\.your-name[a-zA-Z_-]*' node_modules/@heroui/styles/dist/heroui.min.css`. If it hits, rename — don't rely on load order. See `dashboard-design-system` for the `dash-` prefix convention.

## 5. Stale tag-based selector under an ancestor class catches a later-added shared primitive

`.style-editor__colors label` and `.style-editor__colors input[type="color"]` were written for an old hand-rolled `<label><input type="color"></label>` swatch. Once that markup was replaced by the shared `ColorField` component (`.dash-color-field` > `.dash-color-field__input` + `.dash-color-field__label`), the old selectors kept matching — a bare `label`/`input[type=...]` selector matches ANY descendant with that tag, not just the specific markup shape it was written for — and their higher specificity (class + attribute/type, e.g. `(0,2,1)`) silently beat the primitive's own single-class rules (`(0,1,0)`), squashing the label to a clipped 30px box and stretching the swatch input to 150px. Same failure shape hit `.style-editor__settings input` (a generic rule meant for one text field) once a `type="color"` input was added to the same container.

**Check:** after wiring a shared primitive (anything under `app/dashboard/components/ui/`) into a container that has its own bulk/generic tag selectors (`label`, `input`, `button`, `> div`), `grep` the container's class name in `dashboard.css` for any selector that names a bare tag rather than the primitive's own class. Verify the primitive's *outer* class (e.g. `.dash-color-field`) isn't nested inside a container that still carries old catch-all rules from markup that primitive replaced.

## 6. `overflow: clip`/`hidden` on a shared shell ancestor silently disables every `position: sticky` descendant

`.dash-main` (wraps every dashboard page's content, all pages) had `overflow: clip` — added, per an existing comment near the wizard stepper, to clip horizontal overflow. A non-`visible` value on *either* axis makes that ancestor the nearest "scroll container" for CSS sticky-positioning purposes, even when the ancestor itself never scrolls (no scrollbar, content clipped but not overflowing) — so every `position: sticky` descendant anywhere in the dashboard (`.style-editor__preview`, `.moment-inspector`, any future one) silently degrades to behaving like `position: static`, no error, no visual cue except "it just scrolls away instead of pinning." Confirmed live: `.style-editor__preview`'s `top:16` sticky never stuck until this was split into `overflow-x: clip; overflow-y: visible;` (unlike `hidden`, `clip` can be split per-axis without the UA forcing the other axis to `auto`).

**Check:** before adding `overflow: hidden|clip|scroll|auto` to any container that wraps significant page content (not a small self-contained widget), grep for `position: sticky` inside its subtree — if any exist, split the property per-axis instead of setting both, and verify live with the scroll-and-read-`getBoundingClientRect().top`-twice test above. Conversely, if a `position: sticky` element mysteriously never sticks, don't just re-check its own rule — walk every ancestor's computed `overflow` up to the scroll root; the culprit is almost never the sticky element itself.

## 7. An unscoped rule declared AFTER a media-scoped rule silently wins at every width, including inside the media query's own range

`.project-header__actions { display: flex; gap: 9px }` had no base declaration near its sibling `.project-header` rules — it only existed far down the file (~line 4576), UNSCOPED (no `@media` wrapper), positioned AFTER the `@media (max-width: 640px) { .project-header__actions { display: grid; ... } }` block meant to stack it on phone width. A media query doesn't add specificity — with equal specificity, later source position always wins, conditional or not. So the unconditional `display: flex` (declared later) beat the conditional `display: grid` (declared earlier) at EVERY width, including inside 640px, making the phone-stacking rule permanently dead code. Confirmed live: three header action buttons stayed in an unwrapped row and ran off the 375px viewport, `.button`s past the first uncontactable.

This is the mirror image of #3 (two conditional rules racing each other) — here one side isn't conditional at all, so it's easy to miss when scanning for "which media query wins," because the winning declaration doesn't look like part of the responsive system at all.

**Check:** when a component's base (unscoped) rule for a property is found FAR from that component's other base rules — especially past the point in the file where `@media` breakpoint overrides for the same component already appear — that's a red flag. Move it up next to its siblings' base declarations, before any `@media` block touches the same selector. To verify live: `getComputedStyle(el).display` (or whichever property) at the narrow breakpoint — if it doesn't match what the narrowest matching `@media` block says, walk `document.styleSheets` for every rule matching the element with that property (see the snippet in finding #6) and check which one is *last in source order*, not which one *looks* most specific to the viewport.

## 8. Verifying "dead" CSS before deleting it — template literals defeat plain grep

A systematic sweep (E-AUDIT pass) found ~100 rule-blocks (`.dash-overview-*`, `.dash-create-card*`, `.dash-source-form*`, `.dash-upload-button*`, `.dash-project-card__*`, `.dash-project-grid*`, `.dash-style-mini/strip`, `.dash-switch`, `.dash-mobile-header/-balance`, `.dash-icon-button`, `.dash-new-button`, `.dash-sidebar__close`, `.dash-sidebar-backdrop`, `.dash-section-block`, `.dash-profile` (not `-menu`), `.subtitle-preset-grid`, `.transcript-aside/-head/-layout`, `.billing-plan__features/__track`, `.billing-resource-model`, `.project-style-*`, `.project-settings-page*/-list`, `.clip-inspector__accordion`, `.moment-preview__captions`, `.account-actions .is-danger`) with zero matching markup anywhere — all removed. This was a real, if less urgent, instance of #1: wrappers deleted in earlier redesign passes left their CSS behind.

The check that made this safe: a naive `grep -rl "class-name" app --include="*.tsx"` produces false positives for classes built by template literal — `` `tone-${x}` ``, `` `subtitle-overlay--${preset}` ``, `` `preset-${id}` ``, `` `is-${state}` ``, `` `mobile-panel-${panel}` `` all fail a literal grep for their expanded forms (`tone-danger`, `subtitle-overlay--karaoke`, etc.) while being very much alive. Before deleting anything found this way: (1) grep the PREFIX before `${` across the codebase to catch template construction, (2) if found, trace the variable's type/enum to confirm which literal suffixes are actually reachable, (3) for classes on a real, still-rendered element (like `.dash-sidebar` in a mobile hide/show media query) — distinguish "this exact class is dead" from "this element's rule in this exact place is what's currently keeping it hidden/positioned correctly" (e.g. `.dash-sidebar.is-open` was safely dead since nothing ever adds `is-open`, but the sibling base `.dash-sidebar { transform: translateX(-104%); visibility: hidden; }` in the same block was load-bearing — removing it would have made the sidebar reappear in the 761–900px gap the newer `display:none` rule at 760px doesn't cover). Verify live after any bulk removal: `getComputedStyle` on the element at the boundary width, not just a visual screenshot.

## 9. Two independently-tuned breakpoints for related concerns drift apart, leaving a gap where neither's assumptions hold

`.dash-sidebar` hides (and `.dash-main` reclaims its width) at `max-width: 900px`. Separately, `.project-list`/`.project-row` had exactly two tiers: a "narrow but still tabular" 4-column grid (`minmax(250px,1fr) 130px 96px 30px`, columns 3–4 hidden) below `1020px`, and a full card layout below `760px`. Both breakpoints were individually reasonable, tuned in isolation — but nobody had checked what happens in the 760–900px range where the sidebar is *already gone* (so `.dash-main` is at its widest un-collapsed state) while the table is *still* in the "narrow tabular" tier, whose column budget was sized assuming the layout structure at ~900–1020px, not the wider content area actually available once the sidebar vanishes. Confirmed live at 768px: the "СТАТУС"/"РЕЗУЛЬТАТ" column headers and cell text (`"РЕЗУЛЬТ"`, `"0 гото"`) were visibly clipped mid-word — the grid arithmetic technically fit the container width, but individual cells didn't have room to avoid `overflow:hidden`+`white-space:nowrap` truncation.

The fix was to extend the ALREADY-correct, already-verified-at-390px card layout up through the same `900px` breakpoint the sidebar uses, eliminating the awkward middle tier entirely, rather than tuning a third set of column-width numbers for a range that's inherently ambiguous (some of that range has the sidebar, some doesn't, depending on exact width).

**Check:** whenever a component has its own independently-numbered responsive breakpoints (not literally identical to `.dash-sidebar`'s 900px / `.dash-mobile-nav`'s appearance), test it specifically in the range BETWEEN the sidebar's collapse point and the component's own narrowest-tabular tier's edge (here: 760–900px) — not just at the standard 390/768/1440 checkpoints, since 768 happens to land inside exactly this kind of gap and is easy to mistake for "the tablet breakpoint, should be fine" without actually rendering it. When two breakpoints for related-but-separate concerns (nav chrome vs. a specific table's own column math) don't share a number, that mismatch is the bug waiting to happen, even if neither breakpoint is wrong in isolation.

## Standing practice

After any dashboard.css change beyond a single isolated rule: reload the live preview, screenshot the affected page at 390/768/1440, and diff `braces count` (`python3 -c "s=open('...').read(); print(s.count('{'), s.count('}'))"`) to catch an unbalanced edit before it ships.
