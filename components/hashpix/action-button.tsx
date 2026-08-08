"use client"

import { LoaderCircle } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export type ActionTone = "brand" | "light" | "secondary" | "danger" | "quiet"

type ActionButtonProps = ComponentProps<typeof Button> & {
  tone?: ActionTone
  loading?: boolean
}

const variants: Record<ActionTone, NonNullable<ComponentProps<typeof Button>["variant"]>> = {
  brand: "default",
  light: "default",
  secondary: "secondary",
  danger: "destructive",
  quiet: "ghost",
}

export function ActionButton({ tone = "brand", loading = false, className, children, disabled, ...props }: ActionButtonProps) {
  return (
    <Button
      {...props}
      variant={variants[tone]}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={className}
    >
      {loading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </Button>
  )
}

type IconButtonProps = Omit<ActionButtonProps, "children"> & {
  children: ReactNode
  label: string
  tooltip?: string
}

export function IconButton({ label, tooltip = label, className, children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<ActionButton {...props} aria-label={label} className={className}>{children}</ActionButton>}
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
