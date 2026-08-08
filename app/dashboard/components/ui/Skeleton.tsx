"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Loading placeholder for the processing screen's future-clip grid. Its
 * visual treatment is supplied by the canonical product stylesheet.
 */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <div className={cn("dash-skeleton", className)} role="status" aria-busy="true" {...rest} />;
}
