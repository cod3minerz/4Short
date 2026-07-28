import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createProjectSchema, updateProjectSchema } from "../../../../packages/contracts/src/index.js";
import {
  clips,
  jobs,
  mediaObjects,
  momentCandidates,
  momentSearches,
  projectVersions,
  projects,
  sources,
  stylePresets,
  styleVersions,
  uploads,
  workspaces,
} from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { runIdempotent } from "../services/idempotency.js";

function preliminaryFingerprint(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/v1/projects", { preHandler: app.requireWorkspace }, async (request) => {
    const status = (request.query as { status?: string }).status;
    const clauses = [
      eq(projects.workspaceId, request.authContext!.workspaceId),
      isNull(projects.archivedAt),
    ];
    if (status && projects.status.enumValues.includes(status as never)) {
      clauses.push(eq(projects.status, status as typeof projects.status.enumValues[number]));
    }
    const rows = await app.db.select()
      .from(projects)
      .where(and(...clauses))
      .orderBy(desc(projects.updatedAt))
      .limit(100);
    return { items: rows };
  });

  app.get("/v1/projects/:projectId", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const [project] = await app.db.select()
      .from(projects)
      .where(and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, request.authContext!.workspaceId),
      ))
      .limit(1);
    if (!project) throw app.httpErrors.notFound("Project not found");

    const searches = await app.db.select({ id: momentSearches.id })
      .from(momentSearches)
      .where(eq(momentSearches.projectId, project.id))
      .orderBy(desc(momentSearches.createdAt))
      .limit(1);
    const candidates = searches[0]
      ? await app.db.select().from(momentCandidates).where(eq(momentCandidates.searchId, searches[0].id))
      : [];
    const projectClips = await app.db.select().from(clips).where(eq(clips.projectId, project.id));
    return { project, moments: candidates, clips: projectClips };
  });

  app.post("/v1/projects", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const key = getIdempotencyKey(request);
    const { workspaceId, userId } = request.authContext!;
    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key,
      body,
      statusCode: 201,
      execute: async (tx) => {
        const [style] = await tx.select()
          .from(styleVersions)
          .innerJoin(stylePresets, eq(stylePresets.id, styleVersions.stylePresetId))
          .where(and(
            eq(styleVersions.id, body.styleVersionId),
            eq(stylePresets.workspaceId, workspaceId),
          ))
          .limit(1);
        if (!style) throw app.httpErrors.badRequest("Style version does not belong to workspace");

        let sourceId: string;
        let sourcePayload: Record<string, unknown>;
        if (body.source.kind === "upload") {
          const [upload] = await tx.select()
            .from(uploads)
            .where(and(
              eq(uploads.id, body.source.uploadId),
              eq(uploads.workspaceId, workspaceId),
              eq(uploads.status, "completed"),
            ))
            .limit(1);
          if (!upload?.sourceId) throw app.httpErrors.badRequest("Upload is not completed");
          sourceId = upload.sourceId;
          const [media] = await tx.select()
            .from(mediaObjects)
            .where(eq(mediaObjects.id, upload.mediaObjectId))
            .limit(1);
          sourcePayload = {
            kind: "s3",
            bucket: media.bucket,
            key: media.objectKey,
            mimeType: media.mimeType,
          };
        } else {
          const [source] = await tx.insert(sources).values({
            workspaceId,
            kind: "youtube",
            providerRef: body.source.url,
            metadata: { preliminaryFingerprint: preliminaryFingerprint(body.source.url) },
          }).returning();
          sourceId = source.id;
          sourcePayload = { kind: "youtube", url: body.source.url };
        }

        const [workspace] = await tx.select({ planCode: workspaces.planCode })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        const weight = workspace?.planCode === "studio" ? 3
          : workspace?.planCode === "creator" ? 2
            : workspace?.planCode === "start" ? 1.25 : 1;

        const [project] = await tx.insert(projects).values({
          workspaceId,
          createdBy: userId,
          title: body.title,
          status: "probing",
          sourceId,
          styleVersionId: body.styleVersionId,
          idempotencyKey: key,
        }).returning();
        await tx.insert(projectVersions).values({
          projectId: project.id,
          version: 1,
          settings: {
            momentSettings: body.momentSettings,
            projectOverrides: body.projectOverrides ?? {},
          },
          createdBy: userId,
        });
        const [job] = await tx.insert(jobs).values({
          workspaceId,
          projectId: project.id,
          type: body.source.kind === "youtube" ? "youtube_import" : "probe",
          class: "io",
          payload: { sourceId, source: sourcePayload },
          idempotencyKey: `project:${project.id}:probe:v1`,
          estimatedCost: "1",
          queueWeight: String(weight),
        }).returning();
        return { project, job };
      },
    });
    reply.header("Idempotency-Replayed", String(result.replayed));
    return reply.code(result.replayed ? 200 : 201).send(result.value);
  });

  app.patch("/v1/projects/:projectId", { preHandler: app.requireWorkspace }, async (request) => {
    const body = updateProjectSchema.parse(request.body);
    const { projectId } = request.params as { projectId: string };
    const { workspaceId, userId } = request.authContext!;
    return app.db.transaction(async (tx) => {
      const [project] = await tx.select().from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (!project) throw app.httpErrors.notFound("Project not found");
      const nextVersion = project.currentVersion + 1;
      const [previous] = await tx.select().from(projectVersions)
        .where(and(eq(projectVersions.projectId, project.id), eq(projectVersions.version, project.currentVersion)))
        .limit(1);
      await tx.insert(projectVersions).values({
        projectId: project.id,
        version: nextVersion,
        settings: body.settings ?? previous?.settings ?? {},
        createdBy: userId,
      });
      const [updated] = await tx.update(projects).set({
        title: body.title ?? project.title,
        currentVersion: nextVersion,
        updatedAt: new Date(),
      }).where(eq(projects.id, project.id)).returning();
      return updated;
    });
  });

  app.post("/v1/projects/:projectId/render", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { momentIds?: string[] };
    if (!Array.isArray(body.momentIds) || !body.momentIds.length) {
      throw app.httpErrors.badRequest("momentIds is required");
    }
    const key = getIdempotencyKey(request);
    const { workspaceId, userId } = request.authContext!;
    const [project] = await app.db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!project) throw app.httpErrors.notFound("Project not found");
    const candidates = await app.db.select().from(momentCandidates)
      .where(inArray(momentCandidates.id, body.momentIds));
    if (candidates.length !== body.momentIds.length) throw app.httpErrors.badRequest("Unknown moment");

    const created = await app.db.transaction(async (tx) => {
      const output = [];
      for (const candidate of candidates) {
        const [clip] = await tx.insert(clips).values({
          projectId,
          momentCandidateId: candidate.id,
          title: candidate.title,
          status: "queued",
        }).returning();
        const [job] = await tx.insert(jobs).values({
          workspaceId,
          projectId,
          clipId: clip.id,
          type: "face_track",
          class: "cpu_light",
          payload: { clipId: clip.id, momentId: candidate.id, requestedBy: userId },
          idempotencyKey: `${key}:clip:${clip.id}:face-track`,
          estimatedCost: String(Math.max((candidate.endMs - candidate.startMs) / 1000, 1)),
        }).returning();
        output.push({ clip, job });
      }
      await tx.update(projects).set({ status: "rendering", updatedAt: new Date() }).where(eq(projects.id, projectId));
      return output;
    });
    return reply.code(202).send({ items: created });
  });
}
