"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

interface RangeTimelineProps {
  /** Bounds of the underlying media, in seconds. */
  min: number;
  max: number;
  start: number;
  end: number;
  /** Playhead position in seconds; omit to hide it. */
  playhead?: number;
  /** Shortest allowed selection, in seconds. */
  minDuration?: number;
  onChange: (range: { start: number; end: number }) => void;
  onScrub?: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  disabled?: boolean;
  className?: string;
}

type Handle = "start" | "end";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Dual-handle trim timeline. Replaces the editor's two independent
 * `<input type=range>` elements, which had hardcoded bounds, could not
 * express a single selected span, and gave no playhead feedback.
 *
 * Pointer events drive dragging (so mouse, touch and pen share one code
 * path); each handle is also a real focusable slider so the range stays
 * keyboard-operable and screen-reader friendly.
 */
export function RangeTimeline({
  min,
  max,
  start,
  end,
  playhead,
  minDuration = 1,
  onChange,
  onScrub,
  formatTime,
  disabled,
  className,
}: RangeTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);

  const span = Math.max(max - min, 0.001);
  const toPercent = (seconds: number) => ((clamp(seconds, min, max) - min) / span) * 100;

  const secondsAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return min;
      const rect = track.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
      return min + ratio * span;
    },
    [min, span],
  );

  const moveHandle = useCallback(
    (handle: Handle, seconds: number) => {
      if (handle === "start") {
        onChange({ start: clamp(seconds, min, end - minDuration), end });
      } else {
        onChange({ start, end: clamp(seconds, start + minDuration, max) });
      }
    },
    [end, max, min, minDuration, onChange, start],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => moveHandle(dragging, secondsAt(event.clientX));
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, moveHandle, secondsAt]);

  const handleKey = (handle: Handle) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 5 : 1;
    const current = handle === "start" ? start : end;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      moveHandle(handle, current - step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      moveHandle(handle, current + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveHandle(handle, min);
    } else if (event.key === "End") {
      event.preventDefault();
      moveHandle(handle, max);
    }
  };

  return (
    <div className={cn("range-timeline", disabled && "is-disabled", className)}>
      <div
        className="range-timeline__track"
        ref={trackRef}
        onPointerDown={(event) => {
          if (disabled || !onScrub) return;
          // Clicking the track scrubs; handles stop propagation so they drag instead.
          onScrub(secondsAt(event.clientX));
        }}
      >
        <div
          className="range-timeline__selection"
          style={{ left: `${toPercent(start)}%`, right: `${100 - toPercent(end)}%` }}
        />
        {playhead !== undefined ? (
          <div className="range-timeline__playhead" style={{ left: `${toPercent(playhead)}%` }} aria-hidden="true" />
        ) : null}
        {(["start", "end"] as const).map((handle) => {
          const value = handle === "start" ? start : end;
          return (
            <div
              className={cn("range-timeline__handle", dragging === handle && "is-dragging")}
              key={handle}
              style={{ left: `${toPercent(value)}%` }}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={handle === "start" ? "Начало клипа" : "Конец клипа"}
              aria-valuemin={handle === "start" ? min : start + minDuration}
              aria-valuemax={handle === "start" ? end - minDuration : max}
              aria-valuenow={value}
              aria-valuetext={formatTime(value)}
              aria-disabled={disabled}
              onKeyDown={disabled ? undefined : handleKey(handle)}
              onPointerDown={(event) => {
                if (disabled) return;
                event.stopPropagation();
                event.preventDefault();
                setDragging(handle);
              }}
            />
          );
        })}
      </div>
      <div className="range-timeline__scale">
        <span>{formatTime(min)}</span>
        <span>{formatTime(max)}</span>
      </div>
    </div>
  );
}
