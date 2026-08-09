"use client"

import type { ReactNode } from "react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch as PrimitiveSwitch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export type ChoiceOption = { id: string; label: ReactNode }

export function ChoiceSelect({ options, value, onValueChange, label, "aria-label": ariaLabel, fullWidth, className }: {
  options: ChoiceOption[]; value: string; onValueChange: (value: string) => void; label?: string; "aria-label"?: string; fullWidth?: boolean; className?: string
}) {
  return <Select value={value} onValueChange={(next) => { if (next !== null) onValueChange(next) }}>
    <SelectTrigger aria-label={label ?? ariaLabel} className={cn("hp-choice-select", fullWidth && "w-full", className)}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function ChoiceSwitch({ checked, onCheckedChange, label, disabled, className }: {
  checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean; className?: string
}) {
  return <PrimitiveSwitch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} disabled={disabled} className={cn("hp-choice-switch", className)} />
}

export function ChoiceSegmented({ options, value, onValueChange, label, "aria-label": ariaLabel, fullWidth, className }: {
  options: ChoiceOption[]; value: string; onValueChange: (value: string) => void; label?: string; "aria-label"?: string; fullWidth?: boolean; className?: string
}) {
  return <ToggleGroup value={[value]} onValueChange={(next) => { const selected = next[0]; if (selected) onValueChange(selected) }} aria-label={label ?? ariaLabel} className={cn("hp-choice-segmented", fullWidth && "w-full", className)}>
    {options.map((option) => <ToggleGroupItem key={option.id} value={option.id}>{option.label}</ToggleGroupItem>)}
  </ToggleGroup>
}
