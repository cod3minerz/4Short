"use client";

import { Modal } from "@heroui/react";
import type { ReactNode } from "react";

interface DialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * The one modal/dialog/drawer-as-overlay for the dashboard — wraps
 * HeroUI's Modal in controlled mode. Replaces the hand-rolled
 * clip-scope-dialog, project-settings-drawer, transcript-drawer and
 * wizard-source-dialog (each its own <div role="dialog"> + manual
 * backdrop button + Escape-key listener).
 */
export function Dialog({ isOpen, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className={className}>
            <Modal.CloseTrigger aria-label="Закрыть" />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {description ? <p className="dash-eyebrow">{description}</p> : null}
              {children}
            </Modal.Body>
            {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
