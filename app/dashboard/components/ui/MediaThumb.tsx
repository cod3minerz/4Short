import { Clapperboard } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type MediaThumbTone = "accent" | "ink" | "soft";

interface MediaThumbProps {
  /** Real thumbnail once source metadata is available. Missing media is stated honestly, never replaced with a fake brand visual. */
  src?: string;
  alt?: string;
  tone?: MediaThumbTone;
  aspect?: "16:9" | "9:16" | "1:1";
  className?: string;
  children?: ReactNode;
}

const TONE_CLASS: Record<MediaThumbTone, string> = {
  accent: "media-thumb--accent",
  ink: "media-thumb--ink",
  soft: "media-thumb--soft",
};

const ASPECT_CLASS: Record<NonNullable<MediaThumbProps["aspect"]>, string> = {
  "16:9": "media-thumb--16x9",
  "9:16": "media-thumb--9x16",
  "1:1": "media-thumb--1x1",
};

/**
 * The one video-thumbnail container for the dashboard. Replaces three
 * incompatible hand-rolled versions (`dash-project-card__media`,
 * `project-row__thumb`, `result-clip__media`) that used different tone
 * class names — some (`tone-soft` on the project list) had no matching
 * CSS at all and silently rendered nothing.
 *
 * With no `src`, it shows a quiet unavailable state. The component must not
 * invent a logo, generated still, or "HP" monogram in place of real media.
 */
export function MediaThumb({ src, alt, tone = "accent", aspect = "16:9", className, children }: MediaThumbProps) {
  return (
    <div className={cn("media-thumb", ASPECT_CLASS[aspect], !src && TONE_CLASS[tone], className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- thumbnails come from arbitrary source hosts, not next/image's static set
        <img src={src} alt={alt ?? ""} className="media-thumb__image" />
      ) : (
        <span className="media-thumb__empty" role="img" aria-label="Превью недоступно">
          <Clapperboard size={18} aria-hidden="true" />
          <small>Превью недоступно</small>
        </span>
      )}
      {children}
    </div>
  );
}
