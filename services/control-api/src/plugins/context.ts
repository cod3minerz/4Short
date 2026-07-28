import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { workspaceMembers } from "../../../../db/schema.js";
import { auth } from "../auth/index.js";
import { getEnv } from "../env.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: {
      userId: string;
      workspaceId: string;
      role: "owner" | "admin" | "member";
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

export const contextPlugin = fp(async (app: FastifyInstance) => {
  app.decorate("requireWorkspace", async function requireWorkspace(request: FastifyRequest) {
    const userId = await resolveSessionUser(request);
    if (!userId) throw app.httpErrors.unauthorized("Authentication required");

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
});
