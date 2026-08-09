import { Refresh01Icon } from "@hugeicons/core-free-icons"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"

import { AppIcon } from "./app-icon"

type AsyncButtonProps = ComponentProps<typeof Button> & {
  loading?: boolean
}

/**
 * Behavioral loading state only. Geometry, colour, radius and focus remain
 * owned by the canonical Vega Button passed through `variant` and `size`.
 */
function AsyncButton({
  loading = false,
  disabled,
  children,
  ...props
}: AsyncButtonProps) {
  return (
    <Button {...props} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? (
        <AppIcon
          icon={Refresh01Icon}
          size="sm"
          className="animate-spin"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </Button>
  )
}

export { AsyncButton }
export type { AsyncButtonProps }
