# Approved Opus reference rebuild
## Brand update — 2026-10-12
The product name and supplied logo are now Narezai. This is a visible-brand change only: preserve existing routes, API hosts, account identifiers, and local-storage namespaces until an explicit domain/migration plan exists.

Approved 2026-10-12. Branch codex/opus-product-rebuild; baseline 7b4eedf. Recovery codex/recovery-pre-opus-20261012 / d8fc3f6. Main store patch/Memory preserved in /Users/kirill/.codex/hashpix-main-recovery-20261012-Ek2sd1.

## Decisions
HeroUI v3/React Aria, Hugeicons, Onest; Opus dark neutral palette/white primary actions. No Bounded. New core compositions. Landing/blog unchanged; admin UX/competitor extensions excluded.

Follow-up 2026-10-13: do not show an account/avatar dropdown in the sidebar (desktop or drawer). Account settings stay in the lower navigation. Add `Пресеты` and `Уникализация` as visibly disabled `Скоро` navigation stubs until their routes and real capabilities exist; do not imply they are actionable.

Follow-up 2026-10-13: the Home route alone carries a React Bits Aurora WebGL ambience behind the utilities/header and source field. Keep it out of layout flow, use subdued Narezai orange/gray stops, reduced render resolution, no pointer interception, pause when offscreen, and honor reduced motion. The source surface is transparent Liquid Glass with readable blur; its primary action remains white.

## Reference map
| Screenshot time | Screen |
|---|---|
| 13.22.27 | Home: sidebar/account, top-right balance, source field, recent projects |
| 02.47.29, 02.48.01/09/16 | Source/config: submit, language/quote, thumbnail, compact search, range, templates/aspect |
| 02.49.30/57 | Projects processing and menu |
| 03.01.03 | Ready project/retention |
| 02.49.48 | Processing modal |
| 03.01.31/43 | Clip grid |
| 03.03.19 | Clip list |
| 03.02.41 | Clip modal |
| Official Opus apply-the-layouts visual | Editor transcript/canvas/right tools/bottom timeline |
02.49.30 is duplicated. Originals differ in scale/crop; normalize measurements.

## Screen/behavior contract
224px sidebar, 64px collapsed, toggle inside. White logo; Home/Projects plus disabled `Пресеты`/`Уникализация` stubs; lower Help/account settings. No account/avatar dropdown. Top-right real balance/purchase. Drawer below 768px. Continuous canvas, no outer page card/fake bell/team/upgrade.
Home source preflight does not charge. Config uses /dashboard/new and recoverable preflight identity/session draft. Defaults: best/recommended/auto language/whole source/9:16/default style; auto length 10–180 seconds. Supported query/range/length/language/template/aspect controls only. Server saves workspace defaults.
Submit sends auto_render and immutable settings/version snapshot, opens Projects highlighting new card. Old clients default review. Shared idempotent render scheduling runs without browser, preserves fairness/resource budgets and independent clip failures.
Project cards show actual stage/progress/retention, not ETA or plan-derived expiry. Gallery/list share clip entities, URL search/filter/?clip=, local view preference, lazy posters and one active video. Old review_required projects retain manual generation. Modal has video/transcript/actions, next/previous, Back/focus/scroll return. Mobile is full screen.
Editor new layout retains typed HVE commands/drafts/revisions/offline queue/clock/resolved plan/immutable render. Extract model/commands/transcript/player-preview/timeline/inspector/drafts/render. Mobile Text/Segments/Properties. Controls require full executable path.
No collections/teams/Drive/social/XML/4K/model picker/SRT import/auto headline/unsupported zoom/B-roll/don't-clip. Native uploaded media remains multipart. Real unavailable metadata and failure states; no connected mock fallback.

## Delivery ledger
1 Recovery/baseline: recovery committed; main preserved; preview patch transferred separately.
2 Active instructions/visual tokens: implemented; legacy instructions/audit archived, active scope audit names remaining consumers.
3 Foundation/shell: implemented checkpoint, not final UI acceptance. New Home/preflight entry, 224/64 sidebar, drawer, real account/balance, Onest/neutral tokens and shared React Aria portal. Source/config target and downstream pages remain pending next waves.
4 Source/config/auto-render/defaults/aspects: pending.
5 DTO/poster/retention/projects/gallery/modals: pending.
6 Editor: pending.
7 Auxiliary controls/cleanup/final QA: pending.
Each wave: lint/type/tests/scoped audit/browser evidence/commit. Final: all viewports/browsers, keyboard/zoom/reduced motion, comparison, real closed-browser E2E, 100-workspace isolation/idempotency, suites/build, HVE-G4/G3/G7. INSUFFICIENT remains debt. No production release before acceptance.

## Foundation evidence — 2026-10-12
- Main unchanged. Safe loopback-only read-only preview transferred separately in 54d110c; fixture projects/balance are not displayed as actual data by new Home/shell.
- Full lint/typecheck and Next production build passed. Baseline 201 unit tests passed after keeping the white-logo contract. New foundation tests added.
- Scoped audit passes with eight explicit remaining legacy consumers; not a full HeroUI acceptance.
- IAB/Chromium: account menu opens, Escape/collapse operate, drawer closes with focus returning to its trigger; overlays remain inside `.hashpix-product`; 360px no horizontal overflow. Wider viewport/state evidence is still being collected.
- Before/after `/` and `/blog` screenshots 360/1440 stored at `/Users/kirill/.codex/hashpix-opus-evidence/20261012`. Visual composition unchanged; pixel differences include animated landing background/platform placeholder and Next dev indicator. Public metadata/static params unchanged, production output retains all six blog SSG paths.
- HeroUI CSS is loaded once at root; public CSS keeps its scoped contract. Duplicate import/cache initially omitted anatomy; fixed and browser checked. No fresh PressResponder warnings after moving actual trigger controls inside Modal roots.
- No actual API/worker media E2E or Safari/Firefox acceptance claimed; release gates remain pending.

