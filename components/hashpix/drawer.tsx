"use client"

import type { ReactNode } from "react"

import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export function HashpixDrawer({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className={cn("hp-overlay-scope dash-drawer-dialog", className)}>
      <SheetHeader><SheetTitle>{title}</SheetTitle>{description ? <SheetDescription>{description}</SheetDescription> : null}</SheetHeader>
      {children}
      {footer ? <SheetFooter>{footer}</SheetFooter> : null}
    </SheetContent>
  </Sheet>
}
