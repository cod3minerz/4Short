import {
  Blend,
  Focus,
  LayoutGrid,
  MonitorPlay,
  PictureInPicture2,
  Sparkles,
  User,
  Users2,
  type LucideIcon,
} from "lucide-react";
import type { ClipLayout } from "../types";

/**
 * Single source of truth for the "clip format" picker — shared by the new
 * project wizard's format step and the clip editor's frame inspector, so
 * the two never drift into two different option lists.
 *
 * `rendersToday` reflects what services/media-worker/src/fourshort_worker/
 * render.py actually implements, not what the type system merely accepts —
 * see the `clip-formats` skill. Formats needing speaker/face tracking stay
 * `false` until face_track stops returning FACE_MODEL_NOT_INSTALLED. Keep
 * this in sync with render.py and the skill's table in the same change.
 */
export const layoutOptions: Array<{ id: ClipLayout; label: string; hint: string; icon: LucideIcon; rendersToday: boolean }> = [
  { id: "auto", label: "Автоматически", hint: "Мы подберём кадрирование по содержимому", icon: Sparkles, rendersToday: true },
  { id: "solo", label: "Соло", hint: "Фиксированный кадр по центру, без слежения за лицом", icon: User, rendersToday: true },
  { id: "blur", label: "Размытый фон", hint: "Видео 16:9 с размытыми полями под 9:16", icon: Blend, rendersToday: true },
  { id: "active_speaker", label: "Активный спикер", hint: "Камера следует за тем, кто говорит", icon: Focus, rendersToday: false },
  { id: "podcast", label: "Подкаст, 2 спикера", hint: "Два спикера рядом, горизонтальный сплит", icon: Users2, rendersToday: false },
  { id: "panel", label: "Панель", hint: "Несколько участников в сетке", icon: LayoutGrid, rendersToday: false },
  { id: "screen_speaker", label: "Экран + спикер", hint: "Запись экрана с камерой спикера", icon: MonitorPlay, rendersToday: false },
  { id: "picture_in_picture", label: "Картинка в картинке", hint: "Камера поверх основного видео", icon: PictureInPicture2, rendersToday: false },
];

export function layoutToApi(layout: ClipLayout) {
  if (layout === "active_speaker") return { mode: "active_speaker" as const, smoothing: 0.82 };
  if (layout === "podcast" || layout === "panel") return { mode: "two_speakers" as const, split: "horizontal" as const };
  if (layout === "blur") return { mode: "blur_background" as const, blur: 32 };
  if (layout === "picture_in_picture") return { mode: "picture_in_picture" as const, inset: "top_right" as const };
  if (layout === "screen_speaker") return { mode: "screen_gameplay" as const, facePosition: "top" as const };
  if (layout === "static_crop" || layout === "solo") return { mode: "static_crop" as const, x: 0.5, y: 0.5, zoom: 1 };
  return { mode: "auto" as const, safeFallback: "static_crop" as const };
}

/**
 * Inverse of `layoutToApi`, for hydrating the editor from a real saved clip.
 * Lossy for `two_speakers` (podcast vs panel both collapse to it) and for
 * `static_crop` (solo vs a manually-tuned crop) — but every mode that isn't
 * `rendersToday` in `layoutOptions` is still `LockedField`d in this editor's
 * own UI, so a real clip can only ever have been saved with `auto`,
 * `static_crop`, or `blur_background` in practice. Falls back to `auto` for
 * anything else, same graceful-degradation convention as `store.ts`'s
 * `configFromStyle`.
 */
export function layoutFromApi(mode: string): ClipLayout {
  if (mode === "active_speaker") return "active_speaker";
  if (mode === "two_speakers") return "podcast";
  if (mode === "blur_background") return "blur";
  if (mode === "picture_in_picture") return "picture_in_picture";
  if (mode === "screen_gameplay") return "screen_speaker";
  if (mode === "static_crop") return "solo";
  return "auto";
}
