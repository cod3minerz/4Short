"use client";

import { CircleAlert, CircleCheck, Info, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type InfoPanelTone = "neutral" | "accent" | "warning" | "locked";

interface InfoPanelProps {
  tone?: InfoPanelTone;
  icon?: ReactNode;
  children: ReactNode;
  bullets?: string[];
  action?: ReactNode;
  className?: string;
}

const TONE_ICON: Record<InfoPanelTone, ReactNode> = {
  neutral: <Info size={16} />,
  accent: <CircleCheck size={16} />,
  warning: <CircleAlert size={16} />,
  locked: <Lock size={16} />,
};

/**
 * The explanatory strip that follows a selection throughout the wizard —
 * "what does the mode I picked actually do", balance warnings, plan-gated
 * notices. One component instead of a different hand-rolled `<div>` per
 * screen.
 */
export function InfoPanel({ tone = "neutral", icon, children, bullets, action, className }: InfoPanelProps) {
  return (
    <div className={cn("info-panel", `info-panel--${tone}`, className)} role={tone === "warning" ? "status" : undefined}>
      <span className="info-panel__icon" aria-hidden="true">{icon ?? TONE_ICON[tone]}</span>
      <div className="info-panel__body">
        <div className="info-panel__text">{children}</div>
        {bullets?.length ? (
          <ul className="info-panel__bullets">
            {bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
          </ul>
        ) : null}
        {action ? <div className="info-panel__action">{action}</div> : null}
      </div>
    </div>
  );
}
