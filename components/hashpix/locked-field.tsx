import type { ReactNode } from "react"

import { LockIcon } from "@hugeicons/core-free-icons"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { cn } from "@/lib/utils"

import { AppIcon } from "./app-icon"

type LockedFieldProps = { label: string; reason: string; icon?: ReactNode; className?: string }

/** A truthful unavailable capability using the canonical Field composition. */
export function LockedField({ label, reason, icon, className }: LockedFieldProps) {
  return (
    <Field
      orientation="horizontal"
      data-disabled="true"
      aria-disabled="true"
      className={cn("items-start", className)}
    >
      <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
        {icon ?? <AppIcon icon={LockIcon} size="sm" />}
      </span>
      <FieldContent>
        <FieldTitle>{label}</FieldTitle>
        <FieldDescription>{reason}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
