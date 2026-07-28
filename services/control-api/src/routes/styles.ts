import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createStyleSchema, updateStyleSchema } from "../../../../packages/contracts/src/index.js";
import { stylePresets, styleVersions } from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { runIdempotent } from "../services/idempotency.js";

export async function styleRoutes(app: FastifyInstance) {
  app.get("/v1/styles", { preHandler: app.requireWorkspace }, async (request) => {
    const { workspaceId } = request.authContext!;
    const rows = await app.db
      .select({
        id: stylePresets.id,
        name: stylePresets.name,
        description: stylePresets.description,
        isDefault: stylePresets.isDefault,
        version: styleVersions.version,
        versionId: styleVersions.id,
        config: styleVersions.config,
        updatedAt: stylePresets.updatedAt,
      })
      .from(stylePresets)
      .innerJoin(
        styleVersions,
        and(
          eq(styleVersions.stylePresetId, stylePresets.id),
          eq(styleVersions.version, stylePresets.currentVersion),
        ),
      )
      .where(and(
        eq(stylePresets.workspaceId, workspaceId),
        isNull(stylePresets.archivedAt),
      ))
      .orderBy(desc(stylePresets.isDefault), desc(stylePresets.updatedAt));
    return { items: rows };
  });

  app.post("/v1/styles", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createStyleSchema.parse(request.body);
    const key = getIdempotencyKey(request);
    const { workspaceId, userId } = request.authContext!;
    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key,
      body,
      statusCode: 201,
      execute: async (tx) => {
        if (body.makeDefault) {
          await tx.update(stylePresets)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(stylePresets.workspaceId, workspaceId));
        }
        const [preset] = await tx.insert(stylePresets).values({
          workspaceId,
          name: body.name,
          description: body.description,
          isDefault: body.makeDefault,
        }).returning();
        const [version] = await tx.insert(styleVersions).values({
          stylePresetId: preset.id,
          version: 1,
          config: body.config,
          createdBy: userId,
        }).returning();
        return { ...preset, versionId: version.id, version: 1, config: body.config };
      },
    });
    reply.header("Idempotency-Replayed", String(result.replayed));
    return reply.code(result.replayed ? 200 : 201).send(result.value);
  });

  app.put("/v1/styles/:styleId", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = updateStyleSchema.parse(request.body);
    const key = getIdempotencyKey(request);
    const { styleId } = request.params as { styleId: string };
    const { workspaceId, userId } = request.authContext!;
    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key,
      body,
      execute: async (tx) => {
        const [preset] = await tx.select()
          .from(stylePresets)
          .where(and(
            eq(stylePresets.id, styleId),
            eq(stylePresets.workspaceId, workspaceId),
            isNull(stylePresets.archivedAt),
          ))
          .for("update")
          .limit(1);
        if (!preset) throw app.httpErrors.notFound("Style not found");
        if (preset.currentVersion !== body.expectedVersion) {
          throw app.httpErrors.conflict("Style was updated in another session");
        }

        const nextVersion = preset.currentVersion + 1;
        const [version] = await tx.insert(styleVersions).values({
          stylePresetId: preset.id,
          version: nextVersion,
          config: body.config,
          createdBy: userId,
        }).returning();
        if (body.makeDefault) {
          await tx.update(stylePresets)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(stylePresets.workspaceId, workspaceId));
        }
        const [updated] = await tx.update(stylePresets).set({
          name: body.name ?? preset.name,
          description: body.description ?? preset.description,
          currentVersion: nextVersion,
          isDefault: body.makeDefault ?? preset.isDefault,
          updatedAt: new Date(),
        }).where(eq(stylePresets.id, preset.id)).returning();
        return { ...updated, versionId: version.id, version: nextVersion, config: body.config };
      },
    });
    reply.header("Idempotency-Replayed", String(result.replayed));
    return result.value;
  });
}
