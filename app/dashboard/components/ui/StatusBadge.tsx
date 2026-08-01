"use client";

import { Chip } from "@heroui/react";
import type { ReactNode } from "react";

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_TO_COLOR: Record<StatusTone, "default" | "accent" | "success" | "warning" | "danger"> = {
  neutral: "default",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
};

interface StatusBadgeProps {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}

/**
 * The one status/tone pill for the dashboard — wraps HeroUI's Chip.
 * Replaces the hand-rolled `.dash-status.tone-*` pattern that was
 * duplicated with inconsistent tone-name schemes across project cards,
 * the project list, and result clips (`tone-sky`/`tone-ink`/`tone-0`...).
 */
export function StatusBadge({ tone = "neutral", children, className }: StatusBadgeProps) {
  return (
    <Chip color={TONE_TO_COLOR[tone]} size="sm" className={className}>
      {children}
    </Chip>
  );
}
