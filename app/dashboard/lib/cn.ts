/**
 * Dashboard classnames are hand-written BEM-ish CSS (not Tailwind utility
 * classes), so there's no utility-conflict to resolve — a plain filter+join
 * is all `cn()` needs to do here.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
