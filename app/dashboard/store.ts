"use client";

import type { StyleConfig } from "@/packages/contracts/src/media";
import { defaultStyleConfig, productPlans } from "@/packages/product-config/src";
import { useSyncExternalStore } from "react";
import { previewBalanceSeconds, previewPlanCode, projects as previewProjects, styles as previewStyles } from "./data";
import type { Project, ProjectStatus, StylePreset } from "./types";
import { layoutLabelFromConfig, simpleLayoutFromLabel } from "./lib/style-layout";
import {
  ControlApiError,
  createStyle as createApiStyle,
  ensureWorkspace,
  getBillingSummary,
  getStorageSummary,
  getSession,
  getWorkspaceId,
  isControlApiConfigured,
  listProjects,
  listStyles,
  setWorkspaceId,
  updateStyle as updateApiStyle,
  deleteProject as deleteApiProject,
  type ApiStyle,
  type StorageSummary,
} from "./lib/control-api";

type DashboardStore = {
  styles: StylePreset[];
  defaultStyleId: string;
  connection: "loading" | "connected" | "preview" | "error";
  error: string | null;
  savingStyleId: string | null;
  balanceSeconds: number | null;
  planCode: string | null;
  storage: StorageSummary | null;
  /** Real signed-in user, or null when nobody is signed in / API unreachable. */
  user: { name: string | null; email: string } | null;
  projects: Project[];
};

const storageKey = "hashpix:dashboard-presets:preview:v2";
const serverState: DashboardStore = {
  styles: previewStyles.map((style) => ({ ...style, persisted: false })),
  defaultStyleId: previewStyles.find((style) => style.isDefault)?.id ?? previewStyles[0].id,
  connection: "loading",
  error: null,
  savingStyleId: null,
  balanceSeconds: null,
  planCode: null,
  storage: null,
  user: null,
  projects: previewProjects,
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

export function configFromStyle(style: StylePreset): StyleConfig {
  const preset = style.subtitlePreset === "active_word" || style.subtitlePreset === "word_pop"
    ? "bold"
    : style.subtitlePreset;
  return {
    ...defaultStyleConfig,
    // A preset stores the whole config.  Reducing it to a label here used to
    // silently replace `video_image`, PiP and screen/gameplay styles with
    // `auto` whenever any unrelated control was saved.
    layout: style.layoutConfig ?? simpleLayoutFromLabel(style.framing) ?? defaultStyleConfig.layout,
    subtitles: {
      ...defaultStyleConfig.subtitles,
      enabled: style.captions !== "Выключены",
      mode: style.subtitlePreset === "karaoke"
        ? "karaoke"
        : style.subtitlePreset === "word_pop"
          ? "word_by_word"
          : style.subtitlePreset === "active_word" ? "active_word" : "line",
      preset,
      fontFamily: style.fontFamily,
      position: style.subtitlePosition,
      color: style.colors[0],
      activeColor: style.colors[1],
    },
    silence: { ...defaultStyleConfig.silence, enabled: style.silenceRemoval },
    safeZones: style.safeZones,
    title: style.title
      ? {
          text: "Заголовок клипа",
          startMs: 0,
          endMs: 5_000,
          anchor: "top_center",
          widthPercent: 84,
          marginPx: 48,
          opacity: 1,
          radiusPx: 16,
          shadow: true,
          loop: false,
        }
      : undefined,
    logo: style.logo
      ? {
          startMs: 0,
          endMs: 5_000,
          anchor: "top_right",
          widthPercent: 18,
          marginPx: 48,
          opacity: 1,
          radiusPx: 12,
          shadow: false,
          loop: false,
        }
      : undefined,
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

export function styleFromApi(style: ApiStyle): StylePreset {
  return {
    id: style.id,
    name: style.name,
    description: style.description,
    isDefault: style.isDefault,
    captions: style.config.subtitles.enabled ? "Активное слово" : "Выключены",
    subtitlePreset: style.config.subtitles.mode === "active_word"
      ? "active_word"
      : style.config.subtitles.mode === "word_by_word"
        ? "word_pop"
        : style.config.subtitles.preset === "pulse" ? "bold" : style.config.subtitles.preset,
    fontFamily: style.config.subtitles.fontFamily,
    subtitlePosition: style.config.subtitles.position,
    framing: layoutLabelFromConfig(style.config.layout),
    layoutConfig: style.config.layout,
    silenceRemoval: style.config.silence.enabled,
    title: Boolean(style.config.title),
    logo: Boolean(style.config.logo),
    banner: Boolean(style.config.banner),
    safeZones: style.config.safeZones,
    colors: [style.config.subtitles.color, style.config.subtitles.activeColor],
    version: style.version,
    versionId: style.versionId,
    persisted: true,
    dirty: false,
  };
}

function formatUpdatedAt(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (daysAgo === 0) return `Сегодня, ${time}`;
  if (daysAgo === 1) return `Вчера, ${time}`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function formatDurationLabel(ms: number | null) {
  if (!ms) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

const accentRotation: Project["accent"][] = ["sky", "ink", "soft"];

function projectFromApi(item: Awaited<ReturnType<typeof listProjects>>["items"][number]): Project {
  const hash = [...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    id: item.id,
    title: item.title,
    source: item.sourceKind === "youtube" ? "YouTube" : "Файл",
    duration: formatDurationLabel(item.sourceDurationMs),
    durationMinutes: item.sourceDurationMs ? Math.round(item.sourceDurationMs / 60_000) : 0,
    status: item.status as ProjectStatus,
    clipsFound: item.momentsFound,
    clipsReady: item.clipsReady,
    style: "",
    updatedAt: formatUpdatedAt(item.updatedAt),
    accent: accentRotation[hash % accentRotation.length],
    thumbnailUrl: item.sourceThumbnailUrl,
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
        balanceSeconds: previewBalanceSeconds,
        planCode: previewPlanCode,
        storage: {
          planCode: previewPlanCode,
          usedBytes: 0,
          limitBytes: productPlans[previewPlanCode].storageBytes,
          availableBytes: productPlans[previewPlanCode].storageBytes,
          usagePercent: 0,
          blocked: false,
          byKind: {},
        },
      });
    } catch {
      replace({
        ...serverState,
        connection: "preview",
        balanceSeconds: previewBalanceSeconds,
        planCode: previewPlanCode,
        storage: {
          planCode: previewPlanCode,
          usedBytes: 0,
          limitBytes: productPlans[previewPlanCode].storageBytes,
          availableBytes: productPlans[previewPlanCode].storageBytes,
          usagePercent: 0,
          blocked: false,
          byKind: {},
        },
      });
    }
    return;
  }
  // A signed-out visitor should still see the dashboard shell, just without
  // a name — session is resolved first, on its own, so a missing session
  // never blocks the rest of hydration. Resolved outside the try/catch below
  // (and captured in `user`) so a later failure in the workspace-scoped
  // calls can't erase a real signed-in identity: those calls 401 for a
  // genuinely signed-out visitor, which is expected, but they can also fail
  // for unrelated reasons (a transient 500, a network blip) for a real,
  // still-signed-in user — that user must not be reported as `user: null`.
  const session = await getSession().catch(() => null);
  const user = session?.user ? { name: session.user.name ?? null, email: session.user.email } : null;

  try {
    // Nothing else here can succeed without a workspace: every other
    // endpoint requires X-Workspace-Id, and the dashboard has no other way
    // to learn which workspace the signed-in user belongs to. Ensuring one
    // exists (idempotent by user server-side) must happen before anything
    // that needs it, but only for a real, signed-in session.
    if (session?.user && !getWorkspaceId()) {
      const provisioned = await ensureWorkspace();
      setWorkspaceId(provisioned.workspace.id);
    }

    const [stylesResponse, billing, projectsResponse, storage] = await Promise.all([
      listStyles(),
      getBillingSummary(),
      listProjects(),
      getStorageSummary(),
    ]);
    const styles = stylesResponse.items.map(styleFromApi);
    replace({
      styles,
      defaultStyleId: styles.find((style) => style.isDefault)?.id ?? styles[0]?.id ?? "",
      connection: "connected",
      error: null,
      savingStyleId: null,
      balanceSeconds: billing.balance.availableSeconds,
      planCode: billing.planCode,
      storage,
      user,
      projects: projectsResponse.items.map(projectFromApi),
    });
  } catch (error) {
    // Deliberately NOT `...serverState` here: that object carries the fake
    // preview styles/projects (see its definition above), which is correct
    // for the "API not configured at all" preview case but would silently
    // show a real, connected, momentarily-erroring user (expired session, a
    // 500, a network blip) 5 fake demo projects and a fake style library as
    // if they were real. Empty arrays + the error banner are the honest
    // state; `styles-view.tsx`/`projects-view.tsx` both render a real empty
    // state for zero items rather than crashing.
    replace({
      ...serverState,
      styles: [],
      defaultStyleId: "",
      projects: [],
      connection: "error",
      error: error instanceof ControlApiError ? error.message : "Не удалось загрузить данные. Проверьте соединение и попробуйте ещё раз.",
      user,
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

/** Re-reads the balance after an action that spends it (e.g. launching a project). No-op in offline preview mode. */
export async function refreshBalance() {
  if (state.connection !== "connected") return;
  try {
    const billing = await getBillingSummary();
    replace({ ...state, balanceSeconds: billing.balance.availableSeconds, planCode: billing.planCode });
  } catch {
    // Keep the last known balance rather than blanking it over a transient refresh failure.
  }
}

export async function refreshStorage() {
  if (state.connection !== "connected") return;
  try {
    const storage = await getStorageSummary();
    replace({ ...state, storage });
  } catch {
    // A transient metrics error must not erase the last confirmed quota.
  }
}

export async function removeProject(projectId: string) {
  if (state.connection !== "connected") {
    persistPreview({ ...state, projects: state.projects.filter((project) => project.id !== projectId) });
    return;
  }
  await deleteApiProject(projectId);
  replace({ ...state, projects: state.projects.filter((project) => project.id !== projectId) });
  void refreshStorage();
}

export function updateStyle(id: string, patch: Partial<StylePreset>) {
  persistPreview({
    ...state,
    styles: state.styles.map((style) => {
      if (style.id !== id) return style;
      const updatedLayout = patch.framing === undefined ? undefined : simpleLayoutFromLabel(patch.framing);
      return {
        ...style,
        ...patch,
        // The compact style picker can only create fully-described simple
        // layouts. A label change therefore replaces the stored layout only
        // when it has an exact config; unrelated edits retain advanced data.
        ...(updatedLayout ? { layoutConfig: updatedLayout } : {}),
        dirty: true,
      };
    }),
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
      error: error instanceof ControlApiError ? error.message : "Не удалось сохранить стиль. Проверьте соединение и попробуйте ещё раз.",
    });
    throw error;
  }
}

export async function setDefaultStyle(id: string) {
  const previous = state.defaultStyleId;
  const previousStyles = state.styles;
  replace({
    ...state,
    defaultStyleId: id,
    styles: state.styles.map((style) => ({ ...style, isDefault: style.id === id, dirty: style.id === id || style.id === previous ? true : style.dirty })),
  });
  try {
    return await saveStyle(id);
  } catch (error) {
    replace({ ...state, defaultStyleId: previous, styles: previousStyles });
    throw error;
  }
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
    subtitlePreset: "active_word",
    fontFamily: "HVE Sans",
    subtitlePosition: "bottom",
    framing: "Автоматически",
    silenceRemoval: true,
    title: true,
    logo: false,
    banner: false,
    safeZones: ["shorts", "reels", "tiktok", "vk"],
    colors: ["#ffffff", "#f5f5f2"],
    persisted: false,
    dirty: true,
  };
  persistPreview({ ...state, styles: [...state.styles, style] });
  return id;
}
