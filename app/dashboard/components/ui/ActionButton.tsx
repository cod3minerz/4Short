"use client";

import { Button, type ButtonProps } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ActionTone = "brand" | "light" | "secondary" | "danger" | "quiet";

type ActionButtonProps = Omit<ButtonProps, "variant" | "className"> & {
  /** Semantic visual role. The CSS token contract owns every state. */
  tone?: ActionTone;
  children: ReactNode;
  className?: string;
};

/**
 * Canonical product action. It keeps HeroUI/React Aria press semantics while
 * preventing each page from redefining button radii, hover colours and focus
 * rings. A light action intentionally remains neutral on hover — it must
 * never become a surprise blue button.
 */
export function ActionButton({ tone = "brand", className, children, ...props }: ActionButtonProps) {
  return (
    <Button
      {...props}
      className={cn("hp-action", `hp-action--${tone}`, className)}
    >
      {children}
    </Button>
  );
}

type IconButtonProps = Omit<ButtonProps, "variant" | "children" | "className"> & {
  tone?: Exclude<ActionTone, "danger">;
  "aria-label": string;
  /** Visible only on hover/focus; keeps compact tool rails understandable. */
  tooltip?: string;
  children: ReactNode;
  className?: string;
};

/** Canonical icon-only action; the label is deliberately required. */
export function IconButton({ tone = "secondary", className, tooltip, children, ...props }: IconButtonProps) {
  return (
    <Button
      {...props}
      isIconOnly
      data-tooltip={tooltip}
      className={cn("hp-action", "hp-action--icon", `hp-action--${tone}`, className)}
    >
      {children}
    </Button>
  );
}
