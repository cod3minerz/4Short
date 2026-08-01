"use client";

import { Switch as HeroSwitch } from "@heroui/react";
import type { ReactNode } from "react";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Drop-in replacement for the old hand-rolled DashboardSwitch
 * (button[role=switch] + manual CSS) — same checked/onCheckedChange/label
 * call-site shape, but backed by the real HeroUI Switch underneath.
 */
export function Switch({ checked, onCheckedChange, label, disabled, className, ...rest }: SwitchProps) {
  return (
    <HeroSwitch
      isSelected={checked}
      onChange={onCheckedChange}
      isDisabled={disabled}
      aria-label={label ? undefined : rest["aria-label"]}
      className={className}
    >
      <HeroSwitch.Content>
        <HeroSwitch.Control>
          <HeroSwitch.Thumb />
        </HeroSwitch.Control>
        {label}
      </HeroSwitch.Content>
    </HeroSwitch>
  );
}
