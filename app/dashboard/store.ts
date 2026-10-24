"use client";

import { productPlans } from "@/packages/product-config/src";
import { useSyncExternalStore } from "react";
import { previewBalanceSeconds, previewPlanCode, projects as previewProjects, styles as previewStyles } from "./data";
import type { Project, ProjectStatus, StylePreset } from "./types";
import { layoutLabelFromConfig } from "./lib/style-layout";
import {
  ControlApiError,
  ensureWorkspace,
  getBillingSummary,
  getStorageSummary,
  getSession,
  getWorkspaceId,
  isControlApiConfigured,
  hasLocalDevelopmentIdentity,
  isLoopbackHostname,
  listProjects,
  listStyles,
  setWorkspaceId,
  deleteProject as deleteApiProject,
  type ApiStyle,
  type StorageSummary,
} from "./lib/control-api";

type DashboardStore = {
  styles: StylePreset[];
  defaultStyleId: string;
  connection: "loading" | "connected" | "preview" | "error";
  error: string | null;
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
  balanceSeconds: null,
  planCode: null,
  storage: null,
  user: null,
  projects: previewProjects,
};

let state: DashboardStore = serverState;
let hydrated = false;
const listeners = new Set<() => void>();

function isLoopbackDevelopment() {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return false;
  return isLoopbackHostname(window.location.hostname);
}

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
    clipsTotal: item.clipsTotal,
    clipsReady: item.clipsReady,
    clipsAvailable: item.clipsAvailable,
    clipsFailed: item.clipsFailed,
    processing: item.processing,
    style: "",
    updatedAt: formatUpdatedAt(item.updatedAt),
    accent: accentRotation[hash % accentRotation.length],
    thumbnailUrl: item.sourceThumbnailUrl,
    sourceAvailable: item.sourceAvailable,
    sourceExpiresAt: item.sourceExpiresAt,
  };
}

function activatePreview() {
  let parsed: Pick<DashboardStore, "styles" | "defaultStyleId"> | null = null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    parsed = raw ? JSON.parse(raw) as Pick<DashboardStore, "styles" | "defaultStyleId"> : null;
  } catch {
    // A corrupt local preview cache should fall back to the built-in examples.
  }

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
    projects: previewProjects,
  });
}

async function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  if (!isControlApiConfigured()) {
    activatePreview();
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

  // Let developers inspect product routes without creating an account. This is
  // a read-only local preview: skip workspace-scoped API calls and keep the
  // existing sample data. It is unavailable in production builds and on
  // non-loopback hosts; real API authorization remains unchanged.
  const developmentIdentity = hasLocalDevelopmentIdentity();
  if (!user && isLoopbackDevelopment() && !developmentIdentity) {
    activatePreview();
    return;
  }

  try {
    // Nothing else here can succeed without a workspace: every other
    // endpoint requires X-Workspace-Id, and the dashboard has no other way
    // to learn which workspace the signed-in user belongs to. Ensuring one
    // exists (idempotent by user server-side) must happen before anything
    // that needs it, but only for a real, signed-in session.
    if ((session?.user || developmentIdentity) && !getWorkspaceId()) {
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
    // state. The remaining project and wizard surfaces handle an empty style
    // list explicitly rather than crashing.
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

/** Refreshes the real project list after creation and while any project is processing. */
export async function refreshProjects() {
  if (state.connection !== "connected") return;
  try {
    const response = await listProjects();
    replace({ ...state, projects: response.items.map(projectFromApi) });
  } catch {
    // Preserve the last confirmed project list if polling hits a transient error.
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
