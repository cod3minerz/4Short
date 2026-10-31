import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "default" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
};

export function Button({ variant = "default", size = "md", icon, children, className = "", ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && `btn--${variant}`, size !== "md" && `btn--${size}`, !children && "btn--icon", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function Badge({ tone = "default", children }: { tone?: "default" | "local" | "ai" | "accent" | "warn"; children: ReactNode }) {
  return <span className={`badge${tone === "default" ? "" : ` badge--${tone}`}`}>{children}</span>;
}

/** Marks where a step runs: the user's own computer or our AI server. */
export function Where({ where }: { where: "local" | "ai" }) {
  return where === "local" ? (
    <Badge tone="local">
      <Icon name="cpu" size={13} /> на вашем ПК
    </Badge>
  ) : (
    <Badge tone="ai">
      <Icon name="cloud" size={13} /> ИИ-сервер
    </Badge>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Bar({ value, tone }: { value: number; tone?: "signal" }) {
  return (
    <div className={`bar${tone ? ` bar--${tone}` : ""}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page__head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

export const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
