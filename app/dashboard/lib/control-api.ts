"use client";

import type { StyleConfig } from "@/packages/contracts/src/media";

const apiUrl = process.env.NEXT_PUBLIC_CONTROL_API_URL?.replace(/\/$/, "");
const developmentUserId = process.env.NEXT_PUBLIC_DEVELOPMENT_USER_ID;
const workspaceStorageKey = "4short:workspace-id";

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

export async function createProject(input: {
  title: string;
  source:
    | { kind: "youtube"; url: string }
    | { kind: "upload"; uploadId: string; originalFileName: string };
  momentSettings: {
    mode: "best" | "opinions" | "tips" | "stories" | "qa" | "product" | "custom";
    query?: string;
    count: "recommended" | number;
    durationMinSeconds: number;
    durationMaxSeconds: number;
    diversity: "low" | "medium" | "high";
    excludedTopics: string[];
  };
  styleVersionId: string;
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
    moments: unknown[];
    clips: unknown[];
  }>(`/v1/projects/${projectId}`);
}
