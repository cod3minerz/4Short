---
name: anti-slop-landing
description: Rules that keep Narezai marketing pages, copy and visuals free of generic AI-generated filler ("нейрослоп"). Use before writing or reviewing any landing page, marketing section, hero, pricing, FAQ, empty-state or promo copy, and before claiming such work is done.
---

# Anti-slop rules (mandatory, no exceptions)

Slop = output that is statistically average: it looks like every other AI-built page, claims nothing specific and is
attached to no real product detail. The rules below are binding for every marketing surface of Narezai.

## Copy
1. No empty intensifiers or clichés: революционный, мощный, бесшовный, инновационный, передовой, уникальный,
   «раскройте потенциал», «в мире, где…», «новый уровень», «магия», «играючи», «всё в одном», next-level, seamless, unlock.
2. No "не просто X, а Y", no triplets of adjectives, no question headlines, no exclamation marks, no em dash as a rhythm device.
3. Say what the app does with a verb and a noun. Prefer numbers that exist in the repo or were measured; mark example data «пример».
4. No invented testimonials, customer logos, user counts, ratings, press mentions, "trusted by".
5. Every claim must match a capability that exists at the release date (backend-capability-map, no-dead-ui, clip-formats).

## Visual
6. No purple/blue gradient washes, glowing orbs, neon glow, gradient text, aurora/blur blobs, glassmorphism on empty backgrounds,
   sparkle (✦) "AI" badges, emoji as icons, stock 3D, stock faces, fake dashboards with lorem.
7. No row of three identical "icon + title + two lines" cards. Neighbouring sections use different compositions.
8. One accent colour (`--brand-orange`), and it carries meaning (a moment, the active word), never decoration.
9. Radii and type come from the landing tokens only (Gravity UI scale: radii 3/5/6/8/10, weights 400/600, 4px grid).

## Process
10. Every section contains a product artefact (transcript fragment, timeline, subtitles, app window). No artefact, no section.
11. Run `node scripts/audit-landing-slop.mjs` before reporting landing work as finished; it must exit 0.
12. Do not describe the result as "ideal", "best" or production-ready; list open items instead.
