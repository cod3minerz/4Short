"use client";

import { useId } from "react";
import { cn } from "../../lib/cn";

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Colour picker for the style and clip inspectors. Wraps the native colour
 * input — no library gives a better picker than the OS one — but adds the
 * swatch chrome and the readable hex the bare `<input type="color">` never
 * showed, so users can see and copy the exact value.
 */
export function ColorField({ label, value, onChange, className }: ColorFieldProps) {
  const id = useId();
  return (
    <div className={cn("dash-color-field", className)}>
      <input
        className="dash-color-field__input"
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <label className="dash-color-field__label" htmlFor={id}>
        <span>{label}</span>
        <code>{value.toUpperCase()}</code>
      </label>
    </div>
  );
}
