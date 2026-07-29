import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { users, workspaceMembers } from "../../../../db/schema.js";
import {
  hasAdminPermission,
  type AdminPermission,
  type PlatformRole,
} from "../auth/permissions.js";
import { auth } from "../auth/index.js";
import { getEnv } from "../env.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: {
      userId: string;
      workspaceId: string;
      role: "owner" | "admin" | "member";
    };
    platformActor?: {
      userId: string;
      email: string;
      role: PlatformRole;
      persistedRole: PlatformRole;
      bootstrap: boolean;
    };
  }
}

async function resolveSessionUser(request: FastifyRequest) {
  const session = await auth.api.getSession({ headers: new Headers(request.headers as Record<string, string>) });
  if (session?.user?.id) return session.user.id;

  const env = getEnv();
  const developmentUser = request.headers["x-development-user-id"];
  if (env.NODE_ENV !== "production" && typeof developmentUser === "string") return developmentUser;
  return null;
}

async function resolvePlatformActor(app: FastifyInstance, request: FastifyRequest) {
  const userId = await resolveSessionUser(request);
  if (!userId) throw app.httpErrors.unauthorized("Authentication required");
  const [user] = await app.db.select({
    id: users.id,
    email: users.email,
    status: users.status,
    platformRole: users.platformRole,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw app.httpErrors.unauthorized("User no longer exists");
  if (user.status === "suspended") throw app.httpErrors.forbidden("Account is suspended");

  const bootstrapEmails = new Set(
    getEnv().PLATFORM_ADMIN_EMAILS
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const bootstrap = bootstrapEmails.has(user.email.toLowerCase());
  return {
    userId: user.id,
    email: user.email,
    persistedRole: user.platformRole,
    role: bootstrap ? "super_admin" as const : user.platformRole,
    bootstrap,
  };
}

export function assertAdminPermission(
  request: FastifyRequest,
  permission: AdminPermission,
) {
  const actor = request.platformActor;
  if (!actor || !hasAdminPermission(actor.role, permission)) {
    throw request.server.httpErrors.forbidden("Admin permission denied");
  }
  return actor;
}

export const contextPlugin = fp(async (app: FastifyInstance) => {
  app.decorate("requireWorkspace", async function requireWorkspace(request: FastifyRequest) {
    const actor = await resolvePlatformActor(app, request);
    const userId = actor.userId;

    const workspaceId = request.headers["x-workspace-id"];
    if (!workspaceId || Array.isArray(workspaceId)) {
      throw app.httpErrors.badRequest("X-Workspace-Id is required");
    }

    const [membership] = await app.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ))
      .limit(1);

    if (!membership) throw app.httpErrors.forbidden("Workspace access denied");
    request.authContext = { userId, workspaceId, role: membership.role };
  });

  app.decorate("requirePlatformAdmin", async function requirePlatformAdmin(request: FastifyRequest) {
    const actor = await resolvePlatformActor(app, request);
    if (!hasAdminPermission(actor.role, "platform:read")) {
      throw app.httpErrors.forbidden("Platform admin access required");
    }
    request.platformActor = actor;
  });
});
