"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type SelectableRowProps = {
  title: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  className?: string;
  leading?: ReactNode;
};

/** A compact choice inside a product decision, not a visually noisy action. */
export function SelectableRow({
  title,
  description,
  selected = false,
  disabled = false,
  onPress,
  className,
  leading,
}: SelectableRowProps) {
  return (
    <button
      type="button"
      className={cn("hp-selectable-row", selected && "is-selected", className)}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPress}
    >
      <span className="hp-selectable-row__leading" aria-hidden="true">
        {selected ? <Check size={15} /> : leading}
      </span>
      <span className="hp-selectable-row__copy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  );
}
