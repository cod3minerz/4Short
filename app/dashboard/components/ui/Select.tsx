"use client";

import { ListBox, Select as HeroSelect } from "@heroui/react";

export interface SelectOption {
  id: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  placeholder?: string;
  fullWidth?: boolean;
  className?: string;
}

/**
 * The one <select>-equivalent for the dashboard — wraps HeroUI's compound
 * Select with a plain string value/onChange, so call sites look like a
 * native <select> instead of assembling the Trigger/Popover/ListBox
 * anatomy by hand each time. Replaces every raw `<select><option>` in the
 * wizard, styles page, and clip editor.
 */
export function Select({
  options,
  value,
  onChange,
  placeholder,
  fullWidth,
  className,
  ...rest
}: SelectProps) {
  return (
    <HeroSelect
      aria-label={rest["aria-label"]}
      placeholder={placeholder}
      fullWidth={fullWidth}
      className={className}
      value={value}
      onChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <HeroSelect.Trigger>
        <HeroSelect.Value />
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </HeroSelect.Popover>
    </HeroSelect>
  );
}
