"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface LockedFieldProps {
  /** What the feature would do. */
  label: string;
  /** Why it isn't available — must be true and specific, e.g. "На тарифе Эксперт и выше",
   *  "Нужен трекинг лица — пока недоступно". Never a generic "Скоро" if a more honest reason exists. */
  reason: string;
  icon?: ReactNode;
  className?: string;
}

/**
 * The ONLY sanctioned way to show a feature that doesn't work yet — see the
 * `no-dead-ui` skill. A visibly disabled control with a lock and a true,
 * specific reason. Never render a feature as a live-looking button/toggle
 * that silently does nothing; never hide it either (the client wants to see
 * the product's full shape, just honestly marked).
 */
export function LockedField({ label, reason, icon, className }: LockedFieldProps) {
  return (
    <div className={cn("locked-field", className)} aria-disabled="true">
      <span className="locked-field__icon" aria-hidden="true">
        {icon ?? <Lock size={16} />}
      </span>
      <span className="locked-field__body">
        <strong>{label}</strong>
        <small>{reason}</small>
      </span>
    </div>
  );
}
