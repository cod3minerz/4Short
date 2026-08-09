import type { ComponentProps, ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { AsyncButton } from "./async-button"

export type ActionTone = "brand" | "light" | "secondary" | "danger" | "quiet"

type ActionButtonProps = ComponentProps<typeof AsyncButton> & {
  tone?: ActionTone
}

const legacyToneVariants: Record<
  ActionTone,
  NonNullable<ComponentProps<typeof AsyncButton>["variant"]>
> = {
  brand: "default",
  light: "default",
  secondary: "secondary",
  danger: "destructive",
  quiet: "ghost",
}

/**
 * @deprecated Use AsyncButton with canonical `variant` and `size` in migrated
 * routes. The `tone` mapping remains only until route migration removes it.
 */
export function ActionButton({ tone = "brand", children, ...props }: ActionButtonProps) {
  return (
    <AsyncButton
      {...props}
      variant={legacyToneVariants[tone]}
    >
      {children}
    </AsyncButton>
  )
}

type IconButtonProps = Omit<ActionButtonProps, "children" | "size"> & {
  children: ReactNode
  label: string
  tooltip?: string
}

/**
 * Icon controls always inherit the canonical Button icon geometry. `tone` is
 * temporary compatibility for existing feature callers and is not part of the
 * new AsyncButton API.
 */
export function IconButton({
  label,
  tooltip = label,
  children,
  tone = "brand",
  variant,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AsyncButton
            {...props}
            variant={variant ?? legacyToneVariants[tone]}
            size="icon"
            aria-label={label}
          >
            {children}
          </AsyncButton>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
