"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Captions,
  Flame,
  MessageCircle,
  Star,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";

const platforms = ["TikTok", "YouTube Shorts", "Reels", "VK видео"] as const;

const cards = [
  { caption: "Как зацепить зрителя с первого кадра", timecode: "0:27", badge: "Hook", icon: Zap },
  { caption: "Одна фраза — и ролик набирает обороты", timecode: "0:31", badge: "87% score", icon: Flame },
  { caption: "Первые 3 секунды решают всё", timecode: "0:24", badge: "Strong hook", icon: Zap },
  {
    caption: "Сильный момент — не значит длинный",
    timecode: "0:38",
    badge: "92% Viral Score",
    icon: Star,
    showCaptionsIcon: true,
  },
  { caption: "История, которая держит до конца", timecode: "0:44", badge: "Story", icon: MessageCircle },
  { caption: "Три признака сильного клипа", timecode: "0:35", badge: "89% score", icon: TrendingUp },
  { caption: "Момент, который стоит вырезать отдельно", timecode: "0:29", badge: "Hot moment", icon: Flame },
] satisfies Array<{
  caption: string;
  timecode: string;
  badge: string;
  icon: LucideIcon;
  showCaptionsIcon?: boolean;
}>;

export function PlatformCycler() {
  const [index, setIndex] = useState(0);
  const [wordWidth, setWordWidth] = useState<number>();
  const wordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const interval = window.setInterval(
      () => setIndex((current) => (current + 1) % platforms.length),
      2000,
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
    <div className="hero-carousel" aria-label="Примеры вертикальных клипов">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <article
            className={`hero-clip hero-clip--${index + 1}`}
            key={card.caption}
          >
            <div className="hero-clip__media" role="img" aria-label={`Клип: ${card.timecode}`}>
              <span className="hero-clip__placeholder" aria-hidden="true">Медиа 9:16</span>
            </div>
            <div className="hero-clip__badge">
              <Icon aria-hidden="true" size={12} />
              <span>{card.badge}</span>
            </div>
            {card.showCaptionsIcon ? (
              <span className="hero-clip__captions" aria-label="Субтитры добавлены">
                <Captions aria-hidden="true" size={14} />
              </span>
            ) : null}
            <div className="hero-clip__footer">
              <p>{card.caption}</p>
              <span>{card.timecode}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
