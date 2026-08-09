---
name: css-regression-guard
description: Guard Hashpix CSS changes against structural regressions. Use before and after a non-trivial product stylesheet edit, wrapper removal, selector consolidation or responsive change.
---

# CSS regression guard

This is a structural safety skill, not a visual design system. Visual decisions
come from `docs/ui/design-system.md`.

1. **Removed wrapper:** after changing markup, search its old selector across
   the stylesheet; re-scope or delete every surviving dependent rule.
2. **Bulk replacement:** use token-safe boundaries and inspect changed
   declarations. A malformed custom-property value can silently drop a rule.
3. **Cascade/source order:** inspect live computed `display`, grid/flex values,
   overflow and relevant responsive properties at each affected breakpoint.
4. **Generic descendant selectors:** before inserting a shared primitive, audit
   ancestor selectors such as `label`, `input`, `button` and `> div` that may
   override its internal anatomy.
5. **Sticky and overflow:** do not put non-visible overflow on a shared ancestor
   of sticky content without testing the sticky position during real scrolling.
6. **Breakpoint gaps:** test ranges between related shell and component
   breakpoints, not only their nominal endpoints.
7. **Dead CSS:** before deletion, trace dynamic class construction and rendered
   use; static text search alone is insufficient.

After meaningful CSS work, take browser evidence at the required verification
widths and record computed overflow and console state. Never use a legacy
token/library selector as a new implementation technique.
