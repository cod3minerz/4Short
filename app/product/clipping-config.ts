import type { ClippingDefaults } from "../dashboard/lib/control-api";
import type { StyleConfig } from "@/packages/contracts/src/media";

export const cuttingModes = [
  { id: "uniform", label: "Равномерная нарезка" },
] as const;
export type CuttingMode = (typeof cuttingModes)[number]["id"];
export const lengths = [
  { id: "auto", label: "Авто, до 3 минут", min: 10, max: 180 },
  { id: "short", label: "До 30 секунд", min: 10, max: 30 },
  { id: "medium", label: "30–60 секунд", min: 30, max: 60 },
  { id: "long", label: "60–90 секунд", min: 60, max: 90 },
] as const;
export const languages = [{ id: "auto", label: "Автоматически" }, { id: "ru", label: "Русский" }, { id: "en", label: "Английский" }];
export const aspectRatios = [
  { id: "9:16", label: "9:16", width: 1080, height: 1920 }, { id: "1:1", label: "1:1", width: 1080, height: 1080 },
  { id: "16:9", label: "16:9", width: 1920, height: 1080 }, { id: "4:5", label: "4:5", width: 1080, height: 1350 },
] as const;
export const captionPresets: ReadonlyArray<{ id: string; label: string; mode: StyleConfig["subtitles"]["mode"]; preset: StyleConfig["subtitles"]["preset"] }> = [
  { id: "none", label: "Без субтитров", mode: "line", preset: "clean" },
  { id: "clean", label: "Чистый", mode: "line", preset: "clean" },
  { id: "bold", label: "Жирный", mode: "line", preset: "bold" },
  { id: "active_word", label: "Активное слово", mode: "active_word", preset: "active_word" },
  { id: "karaoke", label: "Караоке", mode: "karaoke", preset: "karaoke" },
  { id: "word_pop", label: "По словам", mode: "word_by_word", preset: "word_pop" },
  { id: "minimal_box", label: "На плашке", mode: "line", preset: "minimal_box" },
];
export function captionConfig(base: StyleConfig["subtitles"], id: string): StyleConfig["subtitles"] {
  const preset = captionPresets.find(item => item.id === id);
  if (!preset) return base;
  return { ...base, enabled: id !== "none", preset: preset.preset, mode: preset.mode };
}
export function defaultLength(defaults: ClippingDefaults | null) {
  return lengths.find(length => length.min === defaults?.momentSettings.durationMinSeconds && length.max === defaults?.momentSettings.durationMaxSeconds)?.id ?? "auto";
}
export function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
