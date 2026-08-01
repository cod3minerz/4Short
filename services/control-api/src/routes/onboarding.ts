import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { defaultStyleConfig, productPlans } from "../../../../packages/product-config/src/index.js";
import {
  minuteBuckets,
  plans,
  stylePresets,
  styleVersions,
  workspaceMembers,
  workspaces,
} from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { runIdempotent } from "../services/idempotency.js";
import { auth } from "../auth/index.js";

export async function onboardingRoutes(app: FastifyInstance) {
  /**
   * Idempotent by USER, not just by client-supplied idempotency key — a
   * returning user (new device, cleared storage) must land back on their
   * existing workspace, never get a second, disconnected one. This is the
   * only place a workspace ID is ever minted; the dashboard has no other
   * way to discover which workspace the signed-in user belongs to.
   */
  app.post("/v1/onboarding/workspace", async (request, reply) => {
    const session = await auth.api.getSession({ headers: new Headers(request.headers as Record<string, string>) });
    const developmentUserId = process.env.NODE_ENV !== "production"
      ? request.headers["x-development-user-id"]
      : undefined;
    const userId = session?.user.id ?? (typeof developmentUserId === "string" ? developmentUserId : null);
    if (!userId) throw app.httpErrors.unauthorized("Use an authenticated session");

    const [existingMembership] = await app.db.select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .limit(1);
    if (existingMembership) {
      const [workspace] = await app.db.select().from(workspaces)
        .where(eq(workspaces.id, existingMembership.workspaceId))
        .limit(1);
      if (workspace) return reply.code(200).send({ workspace, defaultStyleVersionId: null });
    }

    const body = request.body as { name?: string };
    const name = body.name?.trim() || "Мой Hashpix";
    const key = getIdempotencyKey(request);
    const provisionalWorkspaceId = crypto.randomUUID();
    const result = await runIdempotent({
      db: app.db,
      workspaceId: provisionalWorkspaceId,
      key,
      body,
      statusCode: 201,
      execute: async (tx) => {
        for (const plan of Object.values(productPlans)) {
          await tx.insert(plans).values({
            code: plan.code,
            name: plan.name,
            priceKopecks: plan.priceKopecks,
            includedSeconds: plan.includedSeconds,
            queueWeight: String(plan.queueWeight),
            activeProjects: plan.activeProjects,
            sourceRetentionDays: plan.sourceRetentionDays,
            outputRetentionDays: plan.outputRetentionDays,
            exportHeight: plan.exportHeight,
            watermark: plan.watermark,
          }).onConflictDoUpdate({
            target: plans.code,
            set: { priceKopecks: plan.priceKopecks, updatedAt: new Date() },
          });
        }
        const [workspace] = await tx.insert(workspaces).values({
          id: provisionalWorkspaceId,
          name,
          slug: `workspace-${provisionalWorkspaceId.slice(0, 8)}`,
          planCode: "free",
        }).returning();
        await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
        await tx.insert(minuteBuckets).values({
          workspaceId: workspace.id,
          source: "free_trial",
          grantedSeconds: productPlans.free.includedSeconds,
          availableSeconds: productPlans.free.includedSeconds,
          priority: 10,
        });
        const [preset] = await tx.insert(stylePresets).values({
          workspaceId: workspace.id,
          name: "Основной",
          description: "Чистые субтитры, автоматический кадр и безопасные зоны.",
          isDefault: true,
        }).returning();
        const [version] = await tx.insert(styleVersions).values({
          stylePresetId: preset.id,
          version: 1,
          config: defaultStyleConfig,
          createdBy: userId,
        }).returning();
        return { workspace, defaultStyleVersionId: version.id };
      },
    });
    return reply.code(result.replayed ? 200 : 201).send(result.value);
  });
}
