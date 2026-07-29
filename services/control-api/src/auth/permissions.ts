export type PlatformRole = "user" | "support" | "admin" | "super_admin";
export type AdminPermission =
  | "platform:read"
  | "users:write"
  | "roles:write"
  | "workspaces:write"
  | "minutes:write"
  | "jobs:write";

const rolePermissions: Record<PlatformRole, ReadonlySet<AdminPermission>> = {
  user: new Set(),
  support: new Set(["platform:read"]),
  admin: new Set(["platform:read", "users:write", "workspaces:write", "minutes:write", "jobs:write"]),
  super_admin: new Set(["platform:read", "users:write", "roles:write", "workspaces:write", "minutes:write", "jobs:write"]),
};

export function hasAdminPermission(role: PlatformRole, permission: AdminPermission) {
  return rolePermissions[role].has(permission);
}
