import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger"

const variants: Record<StatusTone, "default" | "secondary" | "destructive" | "outline"> = { neutral: "secondary", accent: "default", success: "default", warning: "outline", danger: "destructive" }

export function StatusBadge({ tone = "neutral", children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return <Badge variant={variants[tone]} className={className}>{children}</Badge>
}
