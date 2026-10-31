"use client";

import { useEffect, useMemo, useRef } from "react";
import { exampleMoments, formatClock, sourceExample } from "./data";

const BARS = 220;
/** Wave padding is 20px of the 1152px content width: map a wave percentage to the container width. */
const inset = (pct: number) => 1.74 + pct * 0.9653;

/** Deterministic speech-like envelope; the same on server and client so hydration matches. */
function envelope() {
  let seed = 17;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: BARS }, (_, i) => {
    const phrase = 0.55 + 0.45 * Math.sin(i / 5.3) * Math.sin(i / 17.1 + 1);
    return Math.round(18 + Math.abs(phrase) * 56 + rand() * 24);
  });
}

export function CaptionWords({ words, className = "", step = 0.8 }: { words: readonly string[]; className?: string; step?: number }) {
  return (
    <div className={`lp-cap ${className}`} data-n={words.length} style={{ ["--n" as string]: words.length, ["--lp-step" as string]: `${step}s` }}>
      {words.map((word, i) => (
        <span key={word} style={{ ["--i" as string]: i }}>{word}</span>
      ))}
    </div>
  );
}

export function CutScene() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heights = useMemo(envelope, []);

  const ranges = exampleMoments.map((moment, ri) => {
    const first = Math.floor((moment.startSeconds / sourceExample.durationSeconds) * BARS);
    const last = Math.max(first, Math.floor((moment.endSeconds / sourceExample.durationSeconds) * BARS));
    return { moment, ri, first, last, center: ((first + last + 1) / 2 / BARS) * 100 };
  });

  useEffect(() => {
    const el = section.current;
    const target = stage.current;
    if (!el || !target) return;
    const wide = window.matchMedia("(min-width: 881px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!wide.matches || reduce.matches) {
        target.style.setProperty("--p", "1");
        return;
      }
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight + 72;
      const p = Math.min(1, Math.max(0, (-rect.top / Math.max(1, travel)) * 1.18));
      target.style.setProperty("--p", p.toFixed(4));
    };
    // Direct update: one rect read and one style write per scroll event, no rAF (it is paused in background tabs).
    const schedule = update;
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="lp-cut" ref={section} aria-label="Как из длинного видео вырезаются моменты">
      <div className="lp-cut__stage" ref={stage}>
        <div className="lp-container">
          <div className="lp-cut__source">
            <div className="lp-cut__head">
              <span className="lp-cut__file">{sourceExample.file}</span>
              <span className="lp-sample">{sourceExample.meta} · пример</span>
            </div>
            <div className="lp-wave" aria-hidden="true">
              {heights.map((h, i) => {
                const range = ranges.find((r) => i >= r.first && i <= r.last);
                return <span key={i} className="lp-bar" style={{ ["--h" as string]: h, ...(range ? { ["--ri" as string]: range.ri } : {}) }} />;
              })}
            </div>
            <div className="lp-marks" aria-hidden="true">
              {ranges.map((r) => (
                <div key={r.moment.id} className="lp-mark" style={{ left: `${r.center}%`, ["--ri" as string]: r.ri }}>
                  <span>{formatClock(r.moment.startSeconds)}</span>
                </div>
              ))}
            </div>
            <div className="lp-ruler" aria-hidden="true">
              {[0, 10, 20, 30, 40, 50, 60].map((m) => <span key={m}>{m === 0 ? "0:00" : `${m} мин`}</span>)}
            </div>
          </div>
          <div className="lp-links" aria-hidden="true">
            {ranges.map((r, i) => {
              // centre of the 112px clip frame in column i of the 3-column results grid (gap 24px, 1152px wide)
            const to = ((56 + i * (368 + 24)) / 1152) * 100;
              return (
                <svg key={r.moment.id} className="lp-link-wrap" viewBox="0 0 100 56" preserveAspectRatio="none" style={{ ["--ri" as string]: r.ri }}>
                  <path className="lp-link" d={`M ${inset(r.center)} 0 C ${inset(r.center)} 28, ${to} 28, ${to} 56`} />
                </svg>
              );
            })}
          </div>
          <div className="lp-results">
            {exampleMoments.map((moment, ri) => (
              <article className="lp-result" key={moment.id} style={{ ["--ri" as string]: ri }}>
                <div className="lp-frame">
                  <span className="lp-frame__time">{formatClock(moment.endSeconds - moment.startSeconds)}</span>
                  <CaptionWords words={moment.caption} />
                </div>
                <div className="lp-result__text">
                  <span className="lp-result__topic">{moment.topic}</span>
                  <h3>{moment.title}</h3>
                  <p>{moment.lines.find((l) => l.in)?.text}</p>
                  <span className="lp-result__len">{formatClock(moment.startSeconds)}–{formatClock(moment.endSeconds)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
