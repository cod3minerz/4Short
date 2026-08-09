import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { SectionDescription, SectionTitle } from "./typography"

type SectionHeaderProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Route-neutral section heading rhythm. It deliberately owns no card, panel
 * or page spacing so it can be used in settings, dashboard and admin views.
 */
function SectionHeader({
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <SectionTitle>{title}</SectionTitle>
        {description ? (
          <SectionDescription>{description}</SectionDescription>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  )
}

export { SectionHeader }
export type { SectionHeaderProps }
