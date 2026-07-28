"use client";

import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const platforms = ["TikTok", "YouTube Shorts", "Reels", "VK Клипы"] as const;

const clips = [
  { label: "Сильный хук", timecode: "00:27", tone: "ink" },
  { label: "Главная мысль", timecode: "00:31", tone: "blue" },
  { label: "Практический совет", timecode: "00:24", tone: "ink" },
  { label: "Ключевой момент", timecode: "00:38", tone: "blue" },
  { label: "Личная история", timecode: "00:44", tone: "ink" },
  { label: "Разбор ошибки", timecode: "00:35", tone: "blue" },
  { label: "Сильный финал", timecode: "00:29", tone: "ink" },
] as const;

type ClipStyle = CSSProperties & {
  "--distance": number;
  "--side": number;
};

export function PlatformCycler() {
  const [index, setIndex] = useState(0);
  const [wordWidth, setWordWidth] = useState<number>();
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const interval = window.setInterval(
      () => setIndex((current) => (current + 1) % platforms.length),
      2200,
    );
    return () => window.clearInterval(interval);
  }, []);

  useLayoutEffect(() => {
    setWordWidth(wordRef.current?.getBoundingClientRect().width);
  }, [index]);

  return (
    <span
      className="platform-cycler"
      aria-live="polite"
      style={wordWidth ? { width: `${wordWidth}px` } : undefined}
    >
      <span className="platform-cycler__word" key={platforms[index]} ref={wordRef}>
        {platforms[index]}
      </span>
      <svg
        className="platform-cycler__underline"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M1 7.5C15 3 30 10 45 6.5C60 3 75 9.5 99 5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
      </svg>
    </span>
  );
}

export function HeroCarousel() {
  return (
    <div className="hero-carousel" aria-label="Места для будущих вертикальных роликов">
      {clips.map((clip, index) => {
        const offset = index - Math.floor(clips.length / 2);
        const style: ClipStyle = {
          "--distance": Math.abs(offset),
          "--side": Math.sign(offset),
        };

        return (
          <article
            className="hero-clip"
            data-distance={Math.abs(offset)}
            data-tone={clip.tone}
            key={clip.label}
            style={style}
          >
            <div className="hero-clip__media" role="img" aria-label={`Место для видео: ${clip.label}`}>
              <span>9:16</span>
            </div>
            <div className="hero-clip__meta">
              <span>{clip.label}</span>
              <time>{clip.timecode}</time>
            </div>
          </article>
        );
      })}
    </div>
  );
}
