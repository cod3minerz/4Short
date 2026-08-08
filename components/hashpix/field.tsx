import { cloneElement, isValidElement, type ReactNode, useId } from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FieldProps = {
  label: string
  children: ReactNode
  description?: ReactNode
  error?: ReactNode
  className?: string
}

export function Field({ label, children, description, error, className }: FieldProps) {
  const id = useId()
  const control = isValidElement<{ id?: string }>(children)
    ? cloneElement(children, { id: children.props.id ?? id })
    : children

  return (
    <div className={cn("hp-field", className)}>
      <Label htmlFor={isValidElement<{ id?: string }>(children) ? children.props.id ?? id : undefined}>{label}</Label>
      {control}
      {description ? <p className="hp-field__description">{description}</p> : null}
      {error ? <p className="hp-field__error" role="alert">{error}</p> : null}
    </div>
  )
}
