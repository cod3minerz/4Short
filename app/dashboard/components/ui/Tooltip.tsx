"use client";

import { Tooltip as HeroTooltip } from "@heroui/react";
import type { ReactElement, ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  delay?: number;
}

/**
 * Thin wrapper around HeroUI's Tooltip so call sites don't repeat the
 * Tooltip/Tooltip.Content anatomy. Used for the format picker's expanded
 * explanations ("Для лекций, обзоров, личных эфиров...") and anywhere a
 * control's label alone isn't enough context.
 */
export function Tooltip({ content, children, delay = 200 }: TooltipProps) {
  return (
    <HeroTooltip delay={delay}>
      {children}
      <HeroTooltip.Content>
        <p>{content}</p>
      </HeroTooltip.Content>
    </HeroTooltip>
  );
}
