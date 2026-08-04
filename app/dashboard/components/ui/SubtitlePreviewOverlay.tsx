"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "../../lib/cn";
import type { SubtitlePreset } from "../../types";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

interface SubtitlePreviewOverlayProps {
  /** Caption copy; split on whitespace to drive the word-by-word highlight. */
  text: string;
  preset: SubtitlePreset;
  fontFamily?: string;
  fontSize?: number;
  position?: "top" | "center" | "bottom";
  color?: string;
  activeColor?: string;
  /** Step through words on a timer. Ignored when the OS asks for reduced motion. */
  animate?: boolean;
  /** Drive the active word externally (e.g. from real playback time). */
  activeIndex?: number;
  className?: string;
}

const WORD_MS = 420;

/**
 * The single subtitle preview used by the project wizard, the styles page and
 * the clip editor. Before this, each screen rendered its own static markup, so
 * presets were visually indistinguishable and nothing conveyed how captions
 * actually animate — the active-word highlight is the whole point of the
 * feature, and it was the one thing the previews never showed.
 */
export function SubtitlePreviewOverlay({
  text,
  preset,
  fontFamily,
  fontSize,
  position = "bottom",
  color = "var(--hp-text)",
  activeColor,
  animate = true,
  activeIndex,
  className,
}: SubtitlePreviewOverlayProps) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [tick, setTick] = useState(0);
  const reduceMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false, // server render: assume motion is fine, the client corrects it
  );

  const selfDriven = activeIndex === undefined;
  const running = animate && selfDriven && !reduceMotion && words.length > 1;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), WORD_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const current = selfDriven
    ? (running ? tick % words.length : -1)
    : Math.max(-1, Math.min(activeIndex, words.length - 1));

  return (
    <div
      className={cn("subtitle-overlay", `subtitle-overlay--${preset}`, `is-${position}`, className)}
      style={{
        "--subtitle-color": color,
        "--subtitle-active": activeColor ?? color,
        fontFamily: fontFamily ? `${fontFamily}, sans-serif` : undefined,
        fontSize: fontSize ? `${Math.max(12, fontSize * 0.34)}px` : undefined,
      } as React.CSSProperties}
      aria-hidden="true"
    >
      {words.map((word, index) => (
        <span
          className={cn("subtitle-overlay__word", index === current && "is-active")}
          key={`${word}-${index}`}
        >
          {word}
        </span>
      ))}
    </div>
  );
}
