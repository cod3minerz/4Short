"use client";

import type { StyleConfig } from "@/packages/contracts/src/media";

const configuredApiUrl = process.env.NEXT_PUBLIC_CONTROL_API_URL?.replace(/\/$/, "");
const apiUrl = configuredApiUrl && /^https?:\/\//.test(configuredApiUrl) ? configuredApiUrl : "";
const developmentUserId = process.env.NEXT_PUBLIC_DEVELOPMENT_USER_ID;
const workspaceStorageKey = "hashpix:workspace-id";

export class ControlApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export function isControlApiConfigured() {
  return Boolean(apiUrl);
}

export function getWorkspaceId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(workspaceStorageKey);
}

export function setWorkspaceId(workspaceId: string) {
  window.localStorage.setItem(workspaceStorageKey, workspaceId);
}

function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiUrl) throw new ControlApiError("Российский API не подключён к этому окружению", 503, "API_NOT_CONFIGURED");
  const workspaceId = getWorkspaceId();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  if (developmentUserId) headers.set("X-Development-User-Id", developmentUserId);

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as {
      message?: string;
      code?: string;
      issues?: Array<{ path: string; message: string }>;
    };
    throw new ControlApiError(error.message ?? `API error ${response.status}`, response.status, error.code, error.issues);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export type ApiStyle = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  version: number;
  versionId: string;
  config: StyleConfig;
  updatedAt: string;
};

export type ApiSource = {
  id: string;
  kind: "upload" | "youtube";
  providerRef: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  analyzedAt: string | null;
  lastProcessedAt: string | null;
  createdAt: string;
};

export type ApiMoment = {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  topic: string;
  explanation: string;
  score: string | null;
  warnings: string[];
  selected: boolean;
};

export type ApiClip = {
  id: string;
  projectId: string;
  momentCandidateId: string | null;
  title: string;
  socialTitle: string | null;
  socialDescription: string | null;
  status: string;
  currentVersion: number;
};

export async function listStyles() {
  return request<{ items: ApiStyle[] }>("/v1/styles");
}

export async function createStyle(input: {
  name: string;
  description: string;
  config: StyleConfig;
  makeDefault: boolean;
}) {
  return request<ApiStyle>("/v1/styles", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("style-create") },
    body: JSON.stringify(input),
  });
}

export async function updateStyle(styleId: string, input: {
  name: string;
  description: string;
  config: StyleConfig;
  makeDefault?: boolean;
  expectedVersion: number;
}) {
  return request<ApiStyle>(`/v1/styles/${styleId}`, {
    method: "PUT",
    headers: { "Idempotency-Key": idempotencyKey("style-update") },
    body: JSON.stringify(input),
  });
}

export async function createMultipartUpload(file: File) {
  const session = await request<{
    uploadId: string;
    sourceId: string;
    partSize: number;
    partCount: number;
  }>("/v1/uploads", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("upload-create") },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      byteSize: file.size,
    }),
  });

  const completed: Array<{ partNumber: number; etag: string }> = [];
  for (let offset = 0, partNumber = 1; offset < file.size; offset += session.partSize, partNumber += 1) {
    const signed = await request<{ parts: Array<{ partNumber: number; url: string }> }>(
      `/v1/uploads/${session.uploadId}/parts`,
      { method: "POST", body: JSON.stringify({ partNumbers: [partNumber] }) },
    );
    const part = file.slice(offset, Math.min(offset + session.partSize, file.size));
    const uploadResponse = await fetch(signed.parts[0].url, { method: "PUT", body: part });
    if (!uploadResponse.ok) throw new ControlApiError("Не удалось загрузить часть файла", uploadResponse.status, "UPLOAD_PART_FAILED");
    const etag = uploadResponse.headers.get("ETag");
    if (!etag) throw new ControlApiError("S3 не вернул ETag. Проверьте CORS бакета.", 502, "UPLOAD_ETAG_MISSING");
    completed.push({ partNumber, etag });
  }

  await request(`/v1/uploads/${session.uploadId}/complete`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("upload-complete") },
    body: JSON.stringify({ parts: completed }),
  });
  return session;
}

export async function listProjects() {
  return request<{
    items: Array<{
      id: string;
      title: string;
      status: string;
      sourceKind: "upload" | "youtube" | null;
      sourceDurationMs: number | null;
      clipsTotal: number;
      clipsReady: number;
      momentsFound: number;
      updatedAt: string;
    }>;
  }>("/v1/projects");
}

export type StorageSummary = {
  planCode: string;
  usedBytes: number;
  limitBytes: number;
  availableBytes: number;
  usagePercent: number;
  blocked: boolean;
  byKind: Record<string, number>;
};

export async function getStorageSummary() {
  return request<StorageSummary>("/v1/storage");
}

export async function deleteProject(projectId: string) {
  return request<void>(`/v1/projects/${projectId}`, { method: "DELETE" });
}

export async function createProject(input: {
  title: string;
  source:
    | { kind: "youtube"; url: string }
    | { kind: "upload"; uploadId: string; originalFileName: string }
    | { kind: "existing"; sourceId: string };
  momentSettings: {
    mode: "best" | "opinions" | "tips" | "stories" | "qa" | "product" | "custom" | "uniform" | "manual";
    query?: string;
    count: "recommended" | number;
    durationMinSeconds: number;
    durationMaxSeconds: number;
    diversity: "low" | "medium" | "high";
    selectionStrictness?: "wide" | "balanced" | "strict";
    allowThoughtCompletion?: boolean;
    sourceRange?: { startSeconds: number; endSeconds: number };
    excludedTopics: string[];
  };
  styleVersionId: string;
  projectOverrides?: Partial<StyleConfig>;
}) {
  return request<{ project: { id: string; status: string }; job: { id: string } }>("/v1/projects", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("project-create") },
    body: JSON.stringify(input),
  });
}

export async function getProject(projectId: string) {
  return request<{
    project: { id: string; title: string; status: string; errorCode?: string; errorMessage?: string };
    source: ApiSource | null;
    currentVersion: { id: string; version: number; settings: Record<string, unknown> } | null;
    transcript: { id: string; revision: number; language: string } | null;
    moments: ApiMoment[];
    clips: ApiClip[];
  }>(`/v1/projects/${projectId}`);
}

export async function updateProject(projectId: string, input: {
  title?: string;
  settings?: Record<string, unknown>;
}) {
  return request<{ project: { id: string; currentVersion: number } }>(`/v1/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function listSources() {
  return request<{ items: ApiSource[] }>("/v1/sources");
}

export async function updateMoment(projectId: string, momentId: string, input: {
  selected?: boolean;
  title?: string;
  startMs?: number;
  endMs?: number;
  speakerId?: string | null;
  layoutOverride?: Record<string, unknown> | null;
}) {
  return request<{ moment: ApiMoment; revision: number }>(`/v1/projects/${projectId}/moments/${momentId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function createMomentSearch(projectId: string, input: {
  mode: "best" | "opinions" | "tips" | "stories" | "qa" | "product" | "custom" | "uniform" | "manual";
  query?: string;
  count: "recommended" | number;
  durationMinSeconds: number;
  durationMaxSeconds: number;
  diversity: "low" | "medium" | "high";
  selectionStrictness: "wide" | "balanced" | "strict";
  allowThoughtCompletion: boolean;
  excludedTopics: string[];
  resultMode: "append" | "replace";
}) {
  return request<{ job: { id: string } }>(`/v1/projects/${projectId}/moment-searches`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("moment-search") },
    body: JSON.stringify(input),
  });
}

export async function renderSelectedMoments(projectId: string, momentIds: string[]) {
  return request<{ items: Array<{ clip: ApiClip; job: { id: string } }> }>(
    `/v1/projects/${projectId}/render`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey("project-render") },
      body: JSON.stringify({ momentIds }),
    },
  );
}

export async function getTranscript(projectId: string) {
  return request<{
    transcript: { id: string; revision: number; language: string };
    segments: Array<{
      id: string;
      ordinal: number;
      speakerId: string | null;
      startMs: number;
      endMs: number;
      words: Array<Record<string, unknown>>;
      originalText: string;
    }>;
  }>(`/v1/projects/${projectId}/transcript`);
}

export async function createTranscriptRevision(projectId: string, input: {
  expectedRevision: number;
  operations: Array<
    | { type: "replace_text"; segmentId: string; text: string }
    | { type: "hide_word"; segmentId: string; wordIndex: number }
    | { type: "cut_word"; segmentId: string; wordIndex: number }
  >;
}) {
  return request<{ revision: { id: string; revision: number } }>(`/v1/projects/${projectId}/transcript/revisions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("transcript-revision") },
    body: JSON.stringify(input),
  });
}

export async function getClip(projectId: string, clipId: string) {
  return request<{
    clip: ApiClip;
    project: { id: string; title: string; status: string };
    moment: ApiMoment | null;
    version: { id: string; version: number; edl: Record<string, unknown>; renderHash: string } | null;
    artifacts: Array<{ id: string; kind: string; validation: Record<string, unknown> }>;
  }>(`/v1/projects/${projectId}/clips/${clipId}`);
}

export async function updateClip(projectId: string, clipId: string, input: {
  expectedVersion: number;
  title?: string;
  socialTitle?: string;
  socialDescription?: string;
  edl: Record<string, unknown>;
  scope: "clip" | "selected_clips" | "project" | "style" | "new_style";
  selectedClipIds?: string[];
  styleName?: string;
}) {
  return request<{
    clip: ApiClip;
    version: { id: string; version: number; edl: Record<string, unknown> };
    scope: string;
  }>(`/v1/projects/${projectId}/clips/${clipId}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": idempotencyKey("clip-update") },
    body: JSON.stringify(input),
  });
}

/**
 * Cheap, non-AI confirmation of what a pasted YouTube link actually points
 * to — real title/thumbnail via oEmbed, duration only when the backend has
 * YOUTUBE_API_KEY configured (never fabricated otherwise).
 */
export async function getYoutubeMetadata(url: string) {
  return request<{
    title: string | null;
    authorName: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
  }>(`/v1/media/youtube-metadata?url=${encodeURIComponent(url)}`);
}

/**
 * The only way the dashboard learns which workspace a signed-in user
 * belongs to — every other endpoint requires X-Workspace-Id and there is no
 * separate "list my workspaces" route. Idempotent by user on the server: a
 * returning user (new device, cleared storage) gets their existing
 * workspace back, never a second one.
 */
export async function ensureWorkspace(name?: string) {
  return request<{
    workspace: { id: string; name: string; slug: string; planCode: string };
    defaultStyleVersionId: string | null;
  }>("/v1/onboarding/workspace", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("workspace-onboarding") },
    body: JSON.stringify({ name }),
  });
}

/**
 * better-auth's emailOTP plugin (`services/control-api/src/auth/index.ts`) —
 * the only sign-in method configured (`emailAndPassword` is disabled). Real
 * endpoint paths/body shapes, not guessed: verified against
 * `node_modules/better-auth/dist/plugins/email-otp/routes.mjs`.
 */
export async function sendSignInOtp(email: string) {
  return request<{ success: boolean }>("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    body: JSON.stringify({ email, type: "sign-in" }),
  });
}

export async function verifySignInOtp(email: string, otp: string) {
  return request<{ token: string | null; user: { id: string; email: string; name?: string | null } }>(
    "/v1/auth/sign-in/email-otp",
    { method: "POST", body: JSON.stringify({ email, otp }) },
  );
}

/**
 * better-auth is mounted at /v1/auth/* on the control API, so the dashboard
 * can read the real signed-in user instead of showing a hardcoded name.
 * Returns null when nobody is signed in.
 */
export async function getSession() {
  return request<{
    user: { id: string; name?: string | null; email: string } | null;
  } | null>("/v1/auth/get-session");
}

export async function signOut() {
  const result = await request<unknown>("/v1/auth/sign-out", { method: "POST" });
  // A different user signing in on the same browser must not inherit this
  // workspace — requireWorkspace would reject it anyway (403), but clearing
  // it here means the next hydrate() correctly provisions/looks up the new
  // user's own workspace instead of failing first.
  window.localStorage.removeItem(workspaceStorageKey);
  return result;
}

export async function listSessions() {
  return request<Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }>>("/v1/auth/list-sessions");
}

export async function revokeOtherSessions() {
  return request<unknown>("/v1/auth/revoke-other-sessions", { method: "POST" });
}

export async function getBillingSummary() {
  return request<{
    balance: { availableSeconds: number };
    planCode: string;
  }>("/v1/billing/summary");
}

export async function listTransactions() {
  return request<{
    items: Array<{
      id: string;
      title: string;
      date: string;
      amount: number;
      kind: "charge" | "refund" | "credit";
    }>;
  }>("/v1/billing/transactions");
}

export async function purchaseMinutePackage(code: string) {
  return request<{ paymentId: string; status: string; confirmationUrl: string }>(
    `/v1/billing/minute-packages/${code}/purchase`,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey("minute-package-purchase") } },
  );
}

/**
 * Short-lived signed URL for the rendered clip. Throws 404 (ControlApiError)
 * while the render hasn't finished — callers should treat that as "not ready
 * yet", not as an error to surface loudly.
 */
export async function getClipPlayback(projectId: string, clipId: string) {
  return request<{ url: string; mimeType: string; expiresIn: number }>(
    `/v1/projects/${projectId}/clips/${clipId}/playback`,
  );
}

export async function rerenderClip(projectId: string, clipId: string) {
  return request<{ job: { id: string } }>(`/v1/projects/${projectId}/clips/${clipId}/rerender`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("clip-rerender") },
  });
}
