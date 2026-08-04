# Repository agent guidance

For work involving HVE, the media worker, ClipEDL, layouts, tracking, subtitles, rendering, the clip editor, media queues, or media verification, read and follow `.claude/skills/hve-production/SKILL.md` before editing. For tests, benchmarks, releases, or quality claims, also follow `.claude/skills/hve-verification/SKILL.md`.

When beginning a new HVE implementation sequence, start with `docs/architecture/hve-terra-handoff.md` and follow its roadmap order.

Preserve unrelated worktree changes. Product UI must not expose controls that the control API and renderer cannot execute; use the project `no-dead-ui` conventions for unavailable capabilities.

For any product UI work in the dashboard, editor, admin, or authentication views, read and follow `.claude/skills/hashpix-product-ui/SKILL.md`. Before adopting an interaction pattern from another product, read `.claude/skills/hashpix-ux-research/SKILL.md`; before reporting a page as ready, run the evidence-based process in `.claude/skills/hashpix-page-verification/SKILL.md`.
