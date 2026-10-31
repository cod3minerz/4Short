const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  plus: "M12 5v14M5 12h14",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  user: "M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8",
  upload: "M12 16V4m0 0L7 9m5-5l5 5M4 20h16",
  link: "M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  play: "M7 4l13 8-13 8z",
  pause: "M8 5v14M16 5v14",
  check: "M5 12l5 5 9-10",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
  cpu: "M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  scissors: "M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.6 7.4L20 18M8.6 16.6L20 6",
  download: "M12 4v12m0 0l-5-5m5 5l5-5M4 20h16",
  back: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  x: "M6 6l12 12M18 6L6 18",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5",
  type: "M5 6V4h14v2M12 4v16M9 20h6",
  monitor: "M3 5h18v11H3zM8 21h8M12 16v5",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  cloud: "M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  vol: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6",
  wrench: "M14.7 6.3a4 4 0 005 5L21 13l-8 8-3-3 8-8zM9 15l-6 6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      <path d={PATHS[name]} />
    </svg>
  );
}
