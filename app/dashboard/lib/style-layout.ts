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
