import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The compact application-UI text recipe. It intentionally covers only text
 * that has no dedicated semantic primitive (for example `Label` or
 * `CardTitle`). Headings have named components below so their level stays
 * explicit in product markup.
 */
const typographyVariants = cva("", {
  variants: {
    role: {
      body: "text-sm",
      label: "text-sm font-medium",
      muted: "text-sm text-muted-foreground",
      caption: "text-xs text-muted-foreground",
    },
  },
  defaultVariants: {
    role: "body",
  },
})

function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return (
    <h1
      className={cn("text-2xl font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(typographyVariants({ role: "muted" }), className)}
      {...props}
    />
  )
}

function SectionTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cn("text-lg font-semibold", className)} {...props} />
  )
}

function SectionDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(typographyVariants({ role: "muted" }), className)}
      {...props}
    />
  )
}

export {
  PageDescription,
  PageTitle,
  SectionDescription,
  SectionTitle,
  typographyVariants,
}
export type TypographyVariants = VariantProps<typeof typographyVariants>
