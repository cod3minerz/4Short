"use client";

import { cn } from "../../lib/cn";

interface ValueBadgeProps {
  children: string;
  className?: string;
}

/**
 * The small "current value" chip that sits to the right of a field label
 * (e.g. "Случайно", "Случайная" in the style step's fine-tune mode) so the
 * user can scan current settings without opening every control.
 */
export function ValueBadge({ children, className }: ValueBadgeProps) {
  return <span className={cn("value-badge", className)}>{children}</span>;
}
