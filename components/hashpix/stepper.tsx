"use client";

import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { AppIcon } from "./app-icon";
import { cn } from "@/lib/utils";

export interface StepperStep {
  label: string;
  icon: IconSvgElement;
}

interface StepperProps {
  steps: StepperStep[];
  /** 1-indexed current step. */
  current: number;
  className?: string;
}

/**
 * The 4-step roadmap (Источник → Фрагменты → Стиль → Готово), visible from
 * the wizard's first screen so the process reads as finite, not an endless
 * settings scroll — the whole reason the client asked for it. Each step
 * carries its own icon (done/current/future states), not just a number.
 */
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn("flex w-full list-none items-start p-0", className)} aria-label="Этапы создания клипов">
      {steps.map((step, index) => {
        const position = index + 1;
        const state = position < current ? "done" : position === current ? "current" : "future";
        return (
          <li className="stepper-step relative flex min-w-0 flex-1 flex-col items-center gap-2 text-center" data-state={state} key={step.label}>
            <span className="relative z-10 grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground data-[state=current]:border-ring data-[state=current]:text-foreground data-[state=done]:border-primary data-[state=done]:bg-primary data-[state=done]:text-primary-foreground" data-state={state} aria-hidden="true">
              <AppIcon icon={state === "done" ? CheckmarkCircle01Icon : step.icon} size="sm" />
            </span>
            <span className="text-xs font-medium text-muted-foreground data-[state=current]:text-foreground data-[state=done]:text-foreground sm:text-sm" data-state={state} aria-current={state === "current" ? "step" : undefined}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
