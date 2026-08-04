"use client";

const configuredApiUrl = process.env.NEXT_PUBLIC_CONTROL_API_URL?.replace(/\/$/, "");
const apiUrl = configuredApiUrl && /^https?:\/\//.test(configuredApiUrl)
  ? configuredApiUrl
  : typeof window !== "undefined" && /(^|\.)hashpix\.ru$/i.test(window.location.hostname)
    ? "https://api.hashpix.ru"
    : "";
const developmentUserId = process.env.NEXT_PUBLIC_DEVELOPMENT_USER_ID;

export type AdminRole = "support" | "admin" | "super_admin";
export type PlatformRole = "user" | AdminRole;

export type AdminMe = {
  id: string;
  email: string;
  role: AdminRole;
  persistedRole: PlatformRole;
  bootstrap: boolean;
  permissions: {
    usersWrite: boolean;
    rolesWrite: boolean;
    workspacesWrite: boolean;
    minutesWrite: boolean;
    jobsWrite: boolean;
  };
};

export type AdminOverview = {
  users: number;
  workspaces: number;
  projects: { total: number; active: number; failed: number };
  jobs: { queued: number; running: number; failed: number };
  revenueKopecks: number;
  workers: Array<{
    id: string;
    version: string;
    lastHeartbeatAt: string;
    online: boolean;
    capabilities: Record<string, unknown>;
  }>;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  platformRole: PlatformRole;
  status: "active" | "suspended";
  suspensionReason: string | null;
  createdAt: string;
  memberships: Array<{
    workspaceId: string;
    workspaceName: string;
    workspaceRole: "owner" | "admin" | "member";
    planCode: string;
  }>;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  slug: string;
  planCode: "free" | "start" | "creator" | "studio";
  memberCount: number;
  projectCount: number;
  availableSeconds: number;
  createdAt: string;
};

export type AdminJob = {
  id: string;
  type: string;
  class: string;
  status: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectTitle: string | null;
  attemptCount: number;
  maxAttempts: number;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminAuditEvent = {
  id: number;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  workspaceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function isAdminApiConfigured() {
  return Boolean(apiUrl);
}

function commandKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

async function request<T>(path: string, init: RequestInit = {}) {
  if (!apiUrl) throw new AdminApiError("Control API не подключён к этому окружению", 503, "API_NOT_CONFIGURED");
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (developmentUserId) headers.set("X-Development-User-Id", developmentUserId);
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string; code?: string };
    throw new AdminApiError(payload.message ?? `API error ${response.status}`, response.status, payload.code);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function query(search: string, page = 1) {
  const params = new URLSearchParams({ search, page: String(page), limit: "25" });
  return params.toString();
}

export const adminApi = {
  me: () => request<AdminMe>("/v1/admin/me"),
  overview: () => request<AdminOverview>("/v1/admin/overview"),
  users: (search = "", page = 1) =>
    request<Paginated<AdminUser>>(`/v1/admin/users?${query(search, page)}`),
  workspaces: (search = "", page = 1) =>
    request<Paginated<AdminWorkspace>>(`/v1/admin/workspaces?${query(search, page)}`),
  jobs: (search = "", page = 1) =>
    request<Paginated<AdminJob>>(`/v1/admin/jobs?${query(search, page)}`),
  audit: (search = "", page = 1) =>
    request<Paginated<AdminAuditEvent>>(`/v1/admin/audit?${query(search, page)}`),
  updateUserRole: (userId: string, role: PlatformRole) =>
    request<AdminUser>(`/v1/admin/users/${userId}/role`, {
      method: "PUT",
      headers: { "Idempotency-Key": commandKey("admin-user-role") },
      body: JSON.stringify({ role }),
    }),
  updateUserStatus: (userId: string, status: "active" | "suspended", reason?: string) =>
    request<AdminUser>(`/v1/admin/users/${userId}/status`, {
      method: "PUT",
      headers: { "Idempotency-Key": commandKey("admin-user-status") },
      body: JSON.stringify({ status, reason }),
    }),
  updateWorkspacePlan: (workspaceId: string, planCode: AdminWorkspace["planCode"]) =>
    request<AdminWorkspace>(`/v1/admin/workspaces/${workspaceId}/plan`, {
      method: "PUT",
      headers: { "Idempotency-Key": commandKey("admin-workspace-plan") },
      body: JSON.stringify({ planCode }),
    }),
  adjustMinutes: (workspaceId: string, seconds: number, reason: string) =>
    request(`/v1/admin/workspaces/${workspaceId}/minutes/adjust`, {
      method: "POST",
      headers: { "Idempotency-Key": commandKey("admin-minutes") },
      body: JSON.stringify({ seconds, reason }),
    }),
  jobAction: (jobId: string, action: "retry" | "cancel") =>
    request<AdminJob>(`/v1/admin/jobs/${jobId}/${action}`, {
      method: "POST",
      headers: { "Idempotency-Key": commandKey(`admin-job-${action}`) },
    }),
};
