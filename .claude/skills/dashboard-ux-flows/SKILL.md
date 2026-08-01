---
name: dashboard-ux-flows
description: Target UX flows and verification checklist for the 4Short dashboard (4-step wizard, processing screen, clip editor with always-visible right panel). Use whenever building or reviewing any dashboard user flow, to check it against the approved sequence and the per-page production-readiness checklist before calling it done.
---

# 4Short dashboard UX flows

Reference plan: `~/.claude/plans/users-kirill-downloads-theme-css-lively-ritchie.md` — read it for full context/rationale, the mechanics-doc screenshot analysis, and the backend capability audit before large changes. This skill is the condensed, checkable version. Companion skills: `no-dead-ui`, `backend-capability-map`, `clip-formats`, `subtitle-styles`.

## North star

A first-time user lands on `/dashboard`, understands what to do, and has a clip in progress within 5 minutes. The 4-step stepper (Загрузка → Фрагменты → Стили → Результат) is visible from the first screen — it exists specifically to promise the user the process is finite, not an endless settings scroll.

## The new-project wizard — target sequence (from the client's mechanics doc)

The wizard is one calm, centred work area — not a dashboard made of unrelated cards. The stepper spans the usable content width, every stage owns an equal segment, and the labels stay visible at 390 px. Mobile may shorten copy, but it must not collapse the process into anonymous dots.

1. **Загрузка** — three equal source cards (Загрузить / Ссылка / Мои видео), not tabs. The link field is source-agnostic (a link icon, not a YouTube-specific field) with a row of supported-platform icons underneath — **only show icons for platforms the worker actually imports** (`backend-capability-map`). After paste: real loading → replace the source controls in the same page with a confirmation card containing the real thumbnail, title, duration, reserved minutes, remaining balance and a cheap **arithmetic** (never AI) clip-count range estimate. Do not add operationally meaningless marketing reassurance such as «бесплатная проверка», «без списания» or «без карты» below the CTA.
2. **Фрагменты**:
   - Cutting mode: one recommended card (smart AI) + a collapsible "other modes" section (simple/uniform, single-clip). Never invent a second AI-tier upsell (like "Improved AI analysis") that has no real second model or separate charge behind it.
   - Format: visual picker with icons, built from `app/dashboard/lib/layout-options.ts` (the one source of truth). Only formats the worker actually renders are selectable — everything else is `LockedField` (`clip-formats` has the current render-status table).
   - Time range: live arithmetic credit-cost estimate against the real unified balance, with a working dual-handle trim (`RangeTimeline`) if the balance is short.
3. **Стили** — three modes, not two: Быстро (auto) / Тонкая настройка (manual) / **Выбрать из пресетов** (the user's own saved styles — this third tab is an explicit client requirement, easy to forget). Live preview via `SubtitlePreviewOverlay` everywhere a preview is shown.
4. **Результат** — the processing screen. **4 real stages, not 5** — `new-project-wizard.tsx`'s `processingStages` is the actual count; never invent a 5th to match a reference screenshot. Show real per-stage metrics when the backend provides them (bytes downloaded, sub-fragment index), never a fake "estimate" number.

Never invent a step or a sub-feature that requires an AI/model call or a backend capability you haven't verified in `backend-capability-map` — cost estimates before commit are always cheap arithmetic from duration/mode, never a live model call.

## Credits/balance

**One number, everywhere.** Source it from `/v1/billing/summary`. Never reintroduce a `planUsed`/`extra` split anywhere. Icon: diamond/gem.

## Storage and deletion are product state, not dashboard decoration

- Storage comes from `/v1/storage` and is calculated from non-deleted `media_objects`; never render a made-up percentage or a fixed plan quota in the UI.
- Starting a multipart upload reserves its declared bytes inside a workspace-locked transaction. The server must reject an upload that would cross the plan quota; a disabled dropzone alone is not enforcement.
- Expired unfinished uploads stop consuming quota. A completed upload receives the source-retention deadline of the workspace's current plan.
- Show storage compactly where it changes a decision: used / limit / available, plus a blocking message when full. Do not resurrect a dashboard KPI card for it.
- Project deletion needs an explicit confirmation containing the project title. It archives the project, cancels runnable jobs and marks project-owned artifacts deleted so logical quota returns immediately. A source is released only after its last active project is deleted. Copy may promise recovered quota, but never synchronous physical S3 deletion — retention cleanup owns that.

## Clip editor — the structural target

Three-pane layout: **left = transcript only** (the client was explicit: no tabs, no "Elements" panel mixed in here — just the transcript, word-level edit/hide/cut). **Center** = real `<video>` + `SubtitlePreviewOverlay` + trim (`RangeTimeline`, bounded by real media duration). **Right = every section always visible, never click-to-reveal.** Direct client quote: "настройки правого меню и функции мы показываем ВСЕГДА а не только при нажатии. мне не нужно нажимать на текст чтобы поменять стиль субтитров." This is a paradigm change from "inspector shows the selected element's properties" to "inspector is a fixed stack of collapsible sections" — build it with `PanelSection`, not a selection-driven conditional render. Sections that don't have a working backend behind them yet (AI B-roll, AI music, Хук, свой водяной знак, своё аутро) render as `LockedField`, never as a clickable-looking dead control.

## Per-page verification checklist (run this before considering any page done)

1. Zero hardcoded hex/px outside token files, zero `"Ermilov"` (see `dashboard-design-system`).
2. Every interactive control is a shared primitive, a `LockedField`, or a justified exception.
3. Every button has a real handler with a real effect — click it and confirm, don't just read the JSX (see `no-dead-ui`).
4. Checked at 3 breakpoints (390/768/1440) with **actual rendered screenshots**, not just reading the CSS.
5. Loading / error / empty states exist, not just the happy path.
6. Full click-through user journey with no dead ends — from `/dashboard` to an edited, exported clip.
7. Keyboard focus is visible and logical — verify with real Tab presses, not `.focus()` calls (headless automation can report false negatives on `:focus`/`:focus-visible`; a JS-dispatched focus doesn't always match either pseudo-class in this browser tooling).
   - Any `role="tablist"` (project filter row, project moments/clips tabs, clip editor's mobile tabs) needs `app/dashboard/lib/a11y.ts`'s `handleTablistKeyDown` wired to the container's `onKeyDown`, plus `tabIndex={selected ? 0 : -1}` on every `role="tab"` button — click-only tabs were the state for a while (E-AUDIT pass fixed all 3 existing instances). Verify with a real focused element + dispatched `ArrowRight`/`ArrowLeft`/`Home`/`End` `KeyboardEvent`, not just eyeballing the JSX — this browser tooling's own synthesized `key` presses don't always land on the focused element reliably, so a JS-dispatched `KeyboardEvent` is the more trustworthy check here specifically (the opposite caution from the Tab-press note above, which is about `:focus` visibility, not key delivery).
8. A fresh, context-free review pass (a new agent or a deliberate second look) against this exact checklist — if it's not a clean pass, it's not done. Don't self-report "production ready" without having actually run this list. Treat any older/summarized critic findings as claims to re-verify live, not as current fact — code moves and some already get fixed.
9. **For every page that imports from `app/dashboard/data.ts`, trace where that import is actually used.** This was the dominant bug class of the E-AUDIT pass — worse and easier to miss than a dead button, because the page *looks* fully wired: `projects-view.tsx`, `billing-view.tsx`'s transaction history, and `project-workspace.tsx`'s transcript drawer all rendered mock data completely unconditionally, with no `connection`/`canUseApi` branch at all, even though a real API function already existed and was simply never called — meaning a fully-connected production user would still see fixed demo content forever. The `new-project-wizard.tsx` "Мои видео" picker and `clip-editor.tsx`'s load effect were worse still: mock-derived values (a fake source id, mock layout/subtitle/export defaults) flowed into a REAL mutating API call (`createProject`, `updateClip`), which either fails outright (invalid id) or silently overwrites real saved data with mock defaults. Check every `data.ts` import against three questions: (a) is it read from ANYWHERE unconditionally, with no real-fetch alternative reachable when connected? (b) if a real fetch exists elsewhere in the same file, does its result actually flow into what's *displayed/searched*, not just into some other, disconnected part of the state? (c) does anything mock-derived get sent back through a real API call? `grep -n "from \"../data\"" app/dashboard/components/*.tsx` to enumerate every file that needs this check.
