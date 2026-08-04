---
name: Hashpix Dark System
description: A precise dark interface for turning long conversations into publishable clips.
colors:
  canvas: "#000000"
  surface: "#171718"
  surface-raised: "#27272A"
  text: "#FFFFFF"
  text-muted: "rgba(255, 255, 255, 0.58)"
  line: "#27272A"
  line-subtle: "rgba(255, 255, 255, 0.12)"
typography:
  display:
    fontFamily: "Geist Variable, Arial, sans-serif"
    fontSize: "clamp(44px, 5.5vw, 70px)"
    fontWeight: 600
    lineHeight: 0.99
    letterSpacing: "-0.045em"
  body:
    fontFamily: "Geist Variable, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  panel: "16px"
  inner: "12px"
  pill: "999px"
spacing:
  control: "8px"
  compact: "16px"
  section: "clamp(84px, 10vw, 144px)"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
    height: "50px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
    height: "50px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "16px"
---

# Design System: Hashpix Dark System

## Overview

**Creative North Star: "The editing bay after lights out"**

Hashpix is a black, media-first workspace. The landing is a controlled stage: the eye moves from one decisive line of copy to a single source field and then into the visible transformation of a landscape video into clips. It borrows the discipline of an editing interface, not its dense chrome.

The dashboard inherits the same material language without becoming a marketing page: familiar sidebar and right-side working canvas remain intact, while Geist, tonal surfaces and restrained outlines make the tool calm to scan.

**Key Characteristics:**

- Pure black field with white type and content-led color.
- One bright action per context; secondary actions recede to an outline.
- Glass is functional material over visible media or ambient light, never generic decoration.
- Panels are square enough to feel like work surfaces; pills are reserved for action and selection.

## Colors

The palette is intentionally achromatic so actual video frames become the colour system.

### Primary

- **Cut White** (`#FFFFFF`): text and the single primary action on dark surfaces.

### Neutral

- **Edit Black** (`#000000`): canvas and landing background.
- **Timeline Charcoal** (`#171718`): media stages and large panels.
- **Control Graphite** (`#27272A`): control surfaces and structural dividers.
- **Frame Haze** (`rgba(255, 255, 255, 0.12)`): restrained outlines over dark surfaces.
- **Cue Grey** (`rgba(255, 255, 255, 0.58)`): descriptions and contextual text.

**The Video Carries Colour Rule.** UI chrome stays neutral; a video still or a deliberately placed ambient light may add colour only when it proves the media workflow.

## Typography

**Display Font:** Geist Variable, Arial, sans-serif

**Body Font:** Geist Variable, Arial, sans-serif

**Character:** One precise family is used at different scales and weights. Personality comes from compressed display tracking, generous empty black space and unambiguous hierarchy — never a novelty display font.

### Hierarchy

- **Display** (600, `clamp(44px, 5.5vw, 70px)`, 0.99): landing thesis only.
- **Headline** (600, `clamp(34px, 4.5vw, 58px)`, 1.04): section-level product statements.
- **Title** (570–590, 19–28px, 1.1): features, plans and operational groups.
- **Body** (400–500, 14–18px, 1.5–1.55): explanations with a restrained measure.
- **Label** (500–620, 12–14px): controls and compact metadata; no decorative all-caps layer.

**The One Typeface Rule.** Geist is the only font family in marketing and product UI; hierarchy must be made with scale, weight and spacing.

## Layout

Landing content uses a `1200px` maximum container with `24px` side gutters on desktop and `16px` on mobile. The hero centers its thesis and source action; later sections switch to asymmetric two-column reading or equal functional columns. Large landing sections use `clamp(84px, 10vw, 144px)` vertical breathing room.

Below 900px, navigation becomes a real menu and every multi-column section becomes one clear reading column. The dashboard keeps its existing sidebar-plus-main structure; future work maps its semantic roles to the same tokens rather than moving navigation or project tooling.

## Elevation & Depth

Depth comes first from charcoal-on-black tonal layering and one-pixel outlines. Normal panels do not cast soft card shadows. Glass is limited to the header and media transformation overlay: `rgba(68,68,68,.5)` with `backdrop-filter: blur(40px)` over a real moving or ambient visual layer.

**The Material Has Evidence Rule.** A blur must reveal a reason to blur — media, light or content behind it — otherwise use a solid surface.

## Shapes

Large panels and cards use 16px corners; nested media and internal panels use 12px. Buttons, button-in-field actions and compact statuses use 999px. The difference is semantic: a panel holds work, a pill performs an action. Borders are single-pixel and low contrast.

## Components

### Buttons

- **Shape:** pill (`999px`), 50px minimum height.
- **Primary:** Cut White fill with Edit Black text; one primary action per region.
- **Hover / Focus:** soft white dim on hover; 2px white focus ring with 4px offset.
- **Secondary:** transparent fill and Frame Haze border; no false emphasis.

### Cards / Containers

- **Corner Style:** 16px at surface level, 12px inside.
- **Background:** Timeline Charcoal or nearly black depending on information density.
- **Border:** one Frame Haze or Control Graphite line; no border-plus-shadow default.
- **Internal Padding:** 14–25px depending on content density.

### Inputs / Fields

- **Style:** graphite field shell with a 18px radius; its submit action is a separate white pill.
- **Focus:** only the field border brightens; text stays fixed and legible.
- **Error:** muted red border and direct recovery message beneath the source action.

### Navigation

The landing header is a full-width, 72px dark plane, never a floating island. Secondary navigation is low contrast until hover. On mobile it becomes an explicit menu with the same action vocabulary.

### Media Transformation Stage

One large landscape frame, a glass source-to-clips prompt and three vertical clip surfaces show the actual value exchange. It is decorative only in the sense that it is not a control; its labels describe a synthetic example rather than claim customer data.

## Do's and Don'ts

### Do:

- **Do** use empty black space to separate decisions.
- **Do** use real video frames or clearly synthetic workflow examples as proof.
- **Do** keep the product dashboard structurally stable while introducing token-driven materials.
- **Do** expose a single primary action with its result in the label.

### Don't:

- **Don't** introduce a second font, gradient text or a bright product accent for decoration.
- **Don't** make large panels pill-shaped.
- **Don't** use glass without visible content or light beneath it.
- **Don't** create clickable-looking controls that do not trigger an available product action.
