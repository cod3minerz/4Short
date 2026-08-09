import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { SectionDescription, SectionTitle } from "./typography"

type EmptyStateProps = {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Semantic empty-state structure only. A route chooses its surrounding Card
 * or panel; this composition does not create a competing surface.
 */
function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <section
      className={cn("flex flex-col items-center gap-2 text-center", className)}
    >
      {icon ? (
        <div className="text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md flex-col gap-1">
        <SectionTitle>{title}</SectionTitle>
        {description ? (
          <SectionDescription>{description}</SectionDescription>
        ) : null}
      </div>
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </section>
  )
}

export { EmptyState }
export type { EmptyStateProps }
