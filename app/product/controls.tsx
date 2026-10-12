"use client";
import { Label, ListBox, Select } from "@heroui/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { AppIcon } from "@/components/hashpix/app-icon";

/** Shared compact recipe; HeroUI retains the complete picker anatomy. */
export function CompactSelect({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: ReadonlyArray<{ id: string; label: string }>; onChange: (value: string) => void; disabled?: boolean;
}) {
  return <Select className="hp-compact-select" value={value} onChange={key => { if (key !== null) onChange(String(key)); }} isDisabled={disabled}>
    <Label>{label}</Label>
    <Select.Trigger><Select.Value /><Select.Indicator><AppIcon icon={ArrowDown01Icon} size="sm" aria-hidden="true" /></Select.Indicator></Select.Trigger>
    <Select.Popover><ListBox>{options.map(option => <ListBox.Item id={option.id} key={option.id} textValue={option.label}>{option.label}<ListBox.ItemIndicator><AppIcon icon={Tick02Icon} size="sm" aria-hidden="true" /></ListBox.ItemIndicator></ListBox.Item>)}</ListBox></Select.Popover>
  </Select>;
}
