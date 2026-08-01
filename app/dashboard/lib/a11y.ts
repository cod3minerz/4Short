import type { KeyboardEvent } from "react";

/**
 * Arrow-key roving focus for a `role="tablist"` row of `role="tab"` buttons
 * (WAI-ARIA APG tablist pattern, automatic activation) — Left/Right/Home/End
 * move focus AND select, matching how a mouse click already behaves here.
 * Each tab must already be a real, individually-focusable `<button>`; this
 * only adds the arrow-key traversal on top of what's already clickable.
 */
export function handleTablistKeyDown(event: KeyboardEvent<HTMLElement>) {
  const key = event.key;
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (!tabs.length) return;
  const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);
  if (currentIndex === -1) return;

  event.preventDefault();
  const nextIndex = key === "Home"
    ? 0
    : key === "End"
      ? tabs.length - 1
      : key === "ArrowRight"
        ? (currentIndex + 1) % tabs.length
        : (currentIndex - 1 + tabs.length) % tabs.length;

  const next = tabs[nextIndex];
  next.focus();
  next.click();
}
