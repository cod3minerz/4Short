"use client";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

export interface SegmentedControlOption {
  id: string;
  label: React.ReactNode;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  fullWidth?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * The one segmented/toggle-button-group control for the dashboard — wraps
 * HeroUI's ToggleButtonGroup with a plain string value instead of its
 * Set<Key> selection API, so call sites read exactly like the raw
 * `<button className={active ? "is-active" : ""}>` rows it replaces.
 * Replaces: wizard-segmented, wizard-style-mode, wizard-intent-grid,
 * dash-filter-row, clip-option-grid (each was a separate hand-rolled copy).
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  fullWidth,
  size = "md",
  className,
  ...rest
}: SegmentedControlProps) {
  return (
    <ToggleButtonGroup
      aria-label={rest["aria-label"]}
      selectionMode="single"
      disallowEmptySelection
      fullWidth={fullWidth}
      size={size}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (typeof next === "string") onChange(next);
      }}
      className={className}
    >
      {options.map((option) => (
        <ToggleButton key={option.id} id={option.id}>
          <ToggleButtonGroup.Separator />
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
