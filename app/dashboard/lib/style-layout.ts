import type { StyleConfig } from "@/packages/contracts/src/media";

export type StyleLayoutConfig = StyleConfig["layout"];

const labels: Record<StyleLayoutConfig["mode"], string> = {
  auto: "Автоматически",
  active_speaker: "Активный спикер",
  static_crop: "Статичный кадр",
  two_speakers: "Два спикера",
  blur_background: "Фон с размытием",
  video_image: "Видео + изображение",
  picture_in_picture: "Картинка в картинке",
  screen_gameplay: "Экран + спикер",
};

/** A display label is derived from the full persisted layout, never the inverse source of truth. */
export function layoutLabelFromConfig(layout: StyleLayoutConfig): string {
  return labels[layout.mode];
}

/**
 * Only layout choices that have a complete, valid configuration in the
 * compact styles screen can be created from a label. Layouts with an asset or
 * participant assignment stay preserved from their full config until the
 * dedicated editor owns their controls.
 */
export function simpleLayoutFromLabel(label: string): StyleLayoutConfig | undefined {
  switch (label) {
    case "Автоматически": return { mode: "auto", safeFallback: "static_crop" };
    case "Активный спикер": return { mode: "active_speaker", smoothing: 0.82 };
    case "Два спикера": return { mode: "two_speakers", split: "horizontal" };
    case "Фон с размытием": return { mode: "blur_background", blur: 32 };
    case "Статичный кадр": return { mode: "static_crop", x: 0.5, y: 0.5, zoom: 1 };
    default: return undefined;
  }
}
