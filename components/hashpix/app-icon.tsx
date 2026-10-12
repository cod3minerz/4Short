import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const iconSizes = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const

type AppIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon" | "size"> & {
  icon: IconSvgElement
  size?: keyof typeof iconSizes
}

/**
 * Product-level Hugeicons contract: shared sizes and a consistent two-pixel
 * stroke. It has no colour or visual variant system.
 */
function AppIcon({
  icon,
  size = "md",
  strokeWidth = 2,
  className,
  ...props
}: AppIconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={strokeWidth}
      className={cn(iconSizes[size], className)}
      {...props}
    />
  )
}

export { AppIcon, iconSizes }
export type { AppIconProps }
