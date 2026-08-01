"use client";

import { Disclosure } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PanelSectionProps {
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  /** Rendered in the header, before the expand chevron — e.g. an enable Switch. */
  headerControl?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * A collapsible section in the clip editor's right panel. Per the client's
 * explicit rule, the panel's SECTIONS collapse for scannability, but the
 * whole panel is never selection-driven — every section is always present
 * and reachable without first clicking an element in the preview. Wraps
 * HeroUI's Disclosure rather than a hand-rolled <details>.
 */
export function PanelSection({
  icon,
  title,
  badge,
  headerControl,
  children,
  defaultExpanded = true,
  className,
}: PanelSectionProps) {
  return (
    <Disclosure defaultExpanded={defaultExpanded} className={cn("panel-section", className)}>
      <Disclosure.Heading className="panel-section__heading">
        {/* Must be Disclosure.Trigger (a real react-aria Button), not a raw
            <button> — a plain element never registers with the press context
            HeroUI wires up here, so clicks silently do nothing. */}
        <Disclosure.Trigger className="panel-section__trigger">
          {icon ? <span className="panel-section__icon" aria-hidden="true">{icon}</span> : null}
          <span className="panel-section__title">{title}</span>
          {badge}
          <Disclosure.Indicator className="panel-section__indicator">
            <ChevronDown size={16} />
          </Disclosure.Indicator>
        </Disclosure.Trigger>
        {headerControl ? (
          <span className="panel-section__header-control" onClick={(event) => event.stopPropagation()}>
            {headerControl}
          </span>
        ) : null}
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="panel-section__body">{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
