"use client";

import { Drawer as HeroDrawer } from "@heroui/react";
import type { ReactNode } from "react";

interface DrawerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  placement?: "left" | "right" | "top" | "bottom";
  className?: string;
}

/**
 * Side panel for long, scrollable supplementary content — the transcript and
 * the project settings. Deliberately not the centred `Dialog`: a full-height
 * panel keeps the clip list visible alongside it, which a centred modal
 * covers up.
 */
export function Drawer({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  footer,
  placement = "right",
  className,
}: DrawerProps) {
  return (
    <HeroDrawer>
      <HeroDrawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <HeroDrawer.Content placement={placement} className="dash-drawer-content">
          <HeroDrawer.Dialog className={className ? `hp-overlay-scope dash-drawer-dialog ${className}` : "hp-overlay-scope dash-drawer-dialog"}>
            <HeroDrawer.CloseTrigger aria-label="Закрыть" />
            <HeroDrawer.Header>
              <HeroDrawer.Heading>{title}</HeroDrawer.Heading>
            </HeroDrawer.Header>
            <HeroDrawer.Body>
              {description ? <p className="dash-eyebrow">{description}</p> : null}
              {children}
            </HeroDrawer.Body>
            {footer ? <HeroDrawer.Footer>{footer}</HeroDrawer.Footer> : null}
          </HeroDrawer.Dialog>
        </HeroDrawer.Content>
      </HeroDrawer.Backdrop>
    </HeroDrawer>
  );
}
