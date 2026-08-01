"use client";

import { Check } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "../../lib/cn";

export interface StepperStep {
  label: string;
  icon: ComponentType<{ size?: number }>;
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
    <ol className={cn("stepper", className)} aria-label="Этапы создания клипов">
      {steps.map((step, index) => {
        const position = index + 1;
        const state = position < current ? "done" : position === current ? "current" : "future";
        const Icon = step.icon;
        return (
          <li className={cn("stepper__step", `is-${state}`)} key={step.label}>
            <span className="stepper__icon" aria-hidden="true">
              {state === "done" ? <Check size={16} /> : <Icon size={16} />}
            </span>
            <span className="stepper__label" aria-current={state === "current" ? "step" : undefined}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
