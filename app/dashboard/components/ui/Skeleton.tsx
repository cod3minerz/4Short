"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Loading placeholder using our own shimmer token instead of HeroUI's
 * default (which reads HeroUI's generic palette, not --dash-surface-muted,
 * and would visibly mismatch the rest of the dashboard). Used for the
 * processing screen's future-clip grid.
 */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <div className={cn("dash-skeleton", className)} role="status" aria-busy="true" {...rest} />;
}
