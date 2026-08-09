"use client";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { useMemo, type ReactNode } from "react";
import { AppIcon } from "./app-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SampleListItem {
  id: string;
  label: string;
  /** The real rendered sample for this row — a SubtitlePreviewOverlay swatch,
   *  a font-family-styled "Aa", etc. Never a plain text label: see `subtitle-styles`. */
  sample: ReactNode;
  group?: string;
}

interface SampleListProps {
  items: SampleListItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label": string;
  className?: string;
}

/**
 * Scrollable, groupable list of visual samples — the subtitle-style catalogue
 * and the font list both use this shape (each row must render a REAL sample
 * of that style/font, not a generic label — the whole point of both pickers
 * is letting the user see the difference before picking).
 */
export function SampleList({ items, value, onChange, className, ...rest }: SampleListProps) {
  const groupStarts = useMemo(() => {
    const starts = new Set<string>();
    let lastGroup: string | undefined;
    for (const item of items) {
      if (item.group && item.group !== lastGroup) starts.add(item.id);
      lastGroup = item.group;
    }
    return starts;
  }, [items]);

  return (
    <div className={cn("sample-list", className)} role="listbox" aria-label={rest["aria-label"]}>
      {items.map((item) => {
        const showGroup = groupStarts.has(item.id);
        return (
          <div key={item.id}>
            {showGroup ? <div className="sample-list__group">{item.group}</div> : null}
            <Button
              variant="ghost"
              className={cn("sample-list__row", value === item.id && "is-selected")}
              type="button"
              role="option"
              aria-selected={value === item.id}
              onClick={() => onChange(item.id)}
            >
              <span className="sample-list__sample">{item.sample}</span>
              <span className="sample-list__label">{item.label}</span>
              {value === item.id ? <AppIcon icon={Tick02Icon} size="sm" className="sample-list__check" aria-hidden="true" /> : null}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
