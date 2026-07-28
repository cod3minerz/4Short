"use client";

import type { StyleConfig } from "@/packages/contracts/src/media";
import { defaultStyleConfig } from "@/packages/product-config/src";
import { useSyncExternalStore } from "react";
import { styles as previewStyles } from "./data";
import type { StylePreset } from "./types";
import {
  createStyle as createApiStyle,
  isControlApiConfigured,
  listStyles,
  updateStyle as updateApiStyle,
  type ApiStyle,
} from "./lib/control-api";

type DashboardStore = {
  styles: StylePreset[];
  defaultStyleId: string;
  connection: "loading" | "connected" | "preview" | "error";
  error: string | null;
  savingStyleId: string | null;
};

const storageKey = "4short:dashboard-presets:preview:v2";
const serverState: DashboardStore = {
  styles: previewStyles.map((style) => ({ ...style, persisted: false })),
  defaultStyleId: previewStyles.find((style) => style.isDefault)?.id ?? previewStyles[0].id,
  connection: "loading",
  error: null,
  savingStyleId: null,
};

let state: DashboardStore = serverState;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function replace(next: DashboardStore) {
  state = next;
  emit();
}

function persistPreview(next: DashboardStore) {
  replace(next);
  if (typeof window !== "undefined" && next.connection === "preview") {
    window.localStorage.setItem(storageKey, JSON.stringify({
      styles: next.styles,
      defaultStyleId: next.defaultStyleId,
    }));
  }
}

function configFromStyle(style: StylePreset): StyleConfig {
  return {
    ...defaultStyleConfig,
    layout: style.framing === "Активный спикер"
      ? { mode: "active_speaker", smoothing: 0.82 }
      : style.framing === "Два спикера"
        ? { mode: "two_speakers", split: "horizontal" }
        : style.framing === "Фон с размытием"
          ? { mode: "blur_background", blur: 32 }
          : style.framing === "Статичный кадр"
            ? { mode: "static_crop", x: 0.5, y: 0.5, zoom: 1 }
            : { mode: "auto", safeFallback: "static_crop" },
    subtitles: {
      ...defaultStyleConfig.subtitles,
      enabled: style.captions !== "Выключены",
      color: style.colors[0],
      activeColor: style.colors[1],
    },
    silence: { ...defaultStyleConfig.silence, enabled: style.silenceRemoval },
    safeZones: [...defaultStyleConfig.safeZones],
    banner: style.banner
      ? {
          startMs: 0,
          endMs: 5_000,
          anchor: "bottom_center",
          widthPercent: 70,
          marginPx: 48,
          opacity: 1,
          radiusPx: 20,
          shadow: false,
          loop: false,
        }
      : undefined,
  } as StyleConfig;
}

function styleFromApi(style: ApiStyle): StylePreset {
  const layoutLabels: Record<StyleConfig["layout"]["mode"], string> = {
    auto: "Автоматически",
    active_speaker: "Активный спикер",
    static_crop: "Статичный кадр",
    two_speakers: "Два спикера",
    blur_background: "Фон с размытием",
    video_image: "Видео + изображение",
    picture_in_picture: "Картинка в картинке",
    screen_gameplay: "Экран + спикер",
  };
  return {
    id: style.id,
    name: style.name,
    description: style.description,
    isDefault: style.isDefault,
    captions: style.config.subtitles.enabled ? "Активное слово" : "Выключены",
    framing: layoutLabels[style.config.layout.mode],
    silenceRemoval: style.config.silence.enabled,
    banner: Boolean(style.config.banner),
    colors: [style.config.subtitles.color, style.config.subtitles.activeColor],
    version: style.version,
    versionId: style.versionId,
    persisted: true,
    dirty: false,
  };
}

async function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  if (!isControlApiConfigured()) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) as Pick<DashboardStore, "styles" | "defaultStyleId"> : null;
      replace({
        ...serverState,
        styles: parsed?.styles?.length ? parsed.styles : serverState.styles,
        defaultStyleId: parsed?.defaultStyleId ?? serverState.defaultStyleId,
        connection: "preview",
      });
    } catch {
      replace({ ...serverState, connection: "preview" });
    }
    return;
  }
  try {
    const response = await listStyles();
    const styles = response.items.map(styleFromApi);
    replace({
      styles,
      defaultStyleId: styles.find((style) => style.isDefault)?.id ?? styles[0]?.id ?? "",
      connection: "connected",
      error: null,
      savingStyleId: null,
    });
  } catch (error) {
    replace({
      ...serverState,
      connection: "error",
      error: error instanceof Error ? error.message : "Не удалось загрузить стили",
    });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void hydrate();
  return () => listeners.delete(listener);
}

export function useDashboardStore() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}

export function updateStyle(id: string, patch: Partial<StylePreset>) {
  persistPreview({
    ...state,
    styles: state.styles.map((style) => style.id === id ? { ...style, ...patch, dirty: true } : style),
  });
}

export async function saveStyle(id: string) {
  const style = state.styles.find((item) => item.id === id);
  if (!style) throw new Error("Стиль не найден");
  if (state.connection === "preview") {
    persistPreview({
      ...state,
      styles: state.styles.map((item) => item.id === id ? { ...item, dirty: false } : item),
    });
    return style;
  }
  if (state.connection !== "connected") throw new Error(state.error ?? "API недоступен");

  replace({ ...state, savingStyleId: id, error: null });
  try {
    const response = style.persisted
      ? await updateApiStyle(style.id, {
          name: style.name,
          description: style.description,
          config: configFromStyle(style),
          makeDefault: style.isDefault,
          expectedVersion: style.version ?? 1,
        })
      : await createApiStyle({
          name: style.name,
          description: style.description,
          config: configFromStyle(style),
          makeDefault: Boolean(style.isDefault),
        });
    const saved = styleFromApi(response);
    replace({
      ...state,
      savingStyleId: null,
      styles: state.styles.map((item) => item.id === id ? saved : item),
      defaultStyleId: saved.isDefault ? saved.id : state.defaultStyleId,
    });
    return saved;
  } catch (error) {
    replace({
      ...state,
      savingStyleId: null,
      error: error instanceof Error ? error.message : "Не удалось сохранить стиль",
    });
    throw error;
  }
}

export async function setDefaultStyle(id: string) {
  const previous = state.defaultStyleId;
  replace({
    ...state,
    defaultStyleId: id,
    styles: state.styles.map((style) => ({ ...style, isDefault: style.id === id, dirty: style.id === id || style.id === previous ? true : style.dirty })),
  });
  return saveStyle(id);
}

export function duplicateStyle(id: string) {
  const source = state.styles.find((style) => style.id === id);
  if (!source) return null;
  const nextId = crypto.randomUUID();
  const copy: StylePreset = {
    ...source,
    id: nextId,
    name: `${source.name} — копия`,
    isDefault: false,
    version: undefined,
    versionId: undefined,
    persisted: false,
    dirty: true,
  };
  persistPreview({ ...state, styles: [...state.styles, copy] });
  return nextId;
}

export function createStyle() {
  const id = crypto.randomUUID();
  const style: StylePreset = {
    id,
    name: "Новый стиль",
    description: "Настройте оформление под новый формат или рубрику.",
    captions: "Активное слово",
    framing: "Автоматически",
    silenceRemoval: true,
    banner: false,
    colors: ["#ffffff", "#10b8f4"],
    persisted: false,
    dirty: true,
  };
  persistPreview({ ...state, styles: [...state.styles, style] });
  return id;
}
