"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface OptionCardProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: ReactNode;
  /** Shown on hover/focus as a native title attribute — for the fuller explanation
   *  the mechanics doc calls for ("Для лекций, обзоров, личных эфиров..."). */
  tooltip?: string;
  onSelect?: () => void;
  className?: string;
}

/**
 * Icon-tile + title + subtitle + selection state, the single most repeated
 * pattern in the wizard: source type, cutting mode, video format, style
 * mode, render-quality tier. Replaces ~20 near-duplicate hand-rolled cards.
 * Renders as a real <button> — selection always has a real onSelect, never
 * a decorative is-active class with no handler.
 */
export function OptionCard({
  icon,
  title,
  description,
  selected,
  disabled,
  badge,
  tooltip,
  onSelect,
  className,
}: OptionCardProps) {
  return (
    <button
      className={cn("option-card", selected && "is-selected", disabled && "is-disabled", className)}
      type="button"
      disabled={disabled}
      title={tooltip}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {icon ? <span className="option-card__icon" aria-hidden="true">{icon}</span> : null}
      <span className="option-card__body">
        <span className="option-card__title">
          {title}
          {badge}
        </span>
        {description ? <span className="option-card__description">{description}</span> : null}
      </span>
      {selected ? <Check className="option-card__check" size={16} aria-hidden="true" /> : null}
    </button>
  );
}
