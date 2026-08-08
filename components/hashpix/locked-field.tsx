import { Lock } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type LockedFieldProps = { label: string; reason: string; icon?: ReactNode; className?: string }

export function LockedField({ label, reason, icon, className }: LockedFieldProps) {
  return <div className={cn("locked-field", className)} aria-disabled="true"><span className="locked-field__icon" aria-hidden="true">{icon ?? <Lock size={16} />}</span><span className="locked-field__body"><strong>{label}</strong><small>{reason}</small></span></div>
}
