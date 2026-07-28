"use client";

import { useSyncExternalStore } from "react";
import { styles as initialStyles } from "./data";
import type { StylePreset } from "./types";

type DashboardStore = {
  styles: StylePreset[];
  defaultStyleId: string;
};

const storageKey = "4short:dashboard-presets:v1";
const serverState: DashboardStore = {
  styles: initialStyles,
  defaultStyleId: initialStyles.find((style) => style.isDefault)?.id ?? initialStyles[0].id,
};

let state: DashboardStore = serverState;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist(next: DashboardStore) {
  state = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }
  emit();
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DashboardStore;
    if (!Array.isArray(parsed.styles) || !parsed.styles.length || !parsed.defaultStyleId) return;
    state = parsed;
    queueMicrotask(emit);
  } catch {
    window.localStorage.removeItem(storageKey);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  hydrate();
  return () => listeners.delete(listener);
}

export function useDashboardStore() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}

export function updateStyle(id: string, patch: Partial<StylePreset>) {
  persist({
    ...state,
    styles: state.styles.map((style) => style.id === id ? { ...style, ...patch } : style),
  });
}

export function setDefaultStyle(id: string) {
  persist({
    defaultStyleId: id,
    styles: state.styles.map((style) => ({ ...style, isDefault: style.id === id })),
  });
}

export function duplicateStyle(id: string) {
  const source = state.styles.find((style) => style.id === id);
  if (!source) return null;
  const nextId = `${id}-copy-${Date.now()}`;
  const copy: StylePreset = {
    ...source,
    id: nextId,
    name: `${source.name} — копия`,
    isDefault: false,
  };
  persist({ ...state, styles: [...state.styles, copy] });
  return nextId;
}

export function createStyle() {
  const id = `style-${Date.now()}`;
  const style: StylePreset = {
    id,
    name: "Новый стиль",
    description: "Настройте оформление под новый формат или рубрику.",
    captions: "Активное слово",
    framing: "Автоматически",
    silenceRemoval: true,
    banner: false,
    colors: ["#06131a", "#10b8f4"],
  };
  persist({ ...state, styles: [...state.styles, style] });
  return id;
}

