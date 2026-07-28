"use client";

import type { MouseEventHandler } from "react";

type DashboardSwitchProps = {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function DashboardSwitch({
  checked,
  label,
  onCheckedChange,
  disabled = false,
}: DashboardSwitchProps) {
  const toggle: MouseEventHandler<HTMLButtonElement> = () => {
    if (!disabled) onCheckedChange(!checked);
  };

  return (
    <button
      aria-label={label}
      aria-checked={checked}
      className="dash-switch"
      disabled={disabled}
      role="switch"
      type="button"
      onClick={toggle}
    >
      <span aria-hidden="true" />
    </button>
  );
}
