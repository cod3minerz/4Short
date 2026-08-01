import { and, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  clipEdlSchema,
  createMomentSearchSchema,
  createProjectSchema,
  createTranscriptRevisionSchema,
  updateClipSchema,
  updateMomentSchema,
  updateProjectSchema,
  styleConfigSchema,
} from "../../../../packages/contracts/src/index.js";
import {
  clipVersions,
  clips,
  jobs,
  mediaObjects,
  momentCandidates,
  momentRevisions,
  momentSearches,
  projectVersions,
  projects,
  renderArtifacts,
  sources,
  stylePresets,
  styleVersions,
  transcriptRevisions,
  transcriptSegments,
  transcripts,
  uploads,
  workspaces,
} from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { signDownload } from "../lib/s3.js";
import { runIdempotent } from "../services/idempotency.js";
import { buildSubtitleCues } from "../services/subtitles.js";
import { clampExportForPlan, type PlanCode } from "../../../../packages/product-config/src/index.js";

function preliminaryFingerprint(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function versionHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function presentationFromEdl(edl: ReturnType<typeof clipEdlSchema.parse>) {
  return {
    layout: edl.layout,
    subtitles: edl.subtitles,
    silence: edl.silence,
    title: edl.title,
    logo: edl.logo,
    banner: edl.banner,
    export: edl.export,
  };
}

function applyPresentation(
  target: ReturnType<typeof clipEdlSchema.parse>,
  source: ReturnType<typeof clipEdlSchema.parse>,
) {
  return clipEdlSchema.parse({ ...target, ...presentationFromEdl(source) });
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/v1/sources", { preHandler: app.requireWorkspace }, async (request) => {
    const { workspaceId } = request.authContext!;
    const rows = await app.db.select({
      id: sources.id,
      kind: sources.kind,
      providerRef: sources.providerRef,
      durationMs: sources.durationMs,
      metadata: sources.metadata,
      analyzedAt: sources.analyzedAt,
      lastProcessedAt: sources.lastProcessedAt,
      createdAt: sources.createdAt,
    }).from(sources)
      .where(eq(sources.workspaceId, workspaceId))
      .orderBy(desc(sources.lastProcessedAt), desc(sources.createdAt))
      .limit(24);
    return { items: rows };
  });

  app.get("/v1/projects", { preHandler: app.requireWorkspace }, async (request) => {
    const status = (request.query as { status?: string }).status;
    const clauses = [
      eq(projects.workspaceId, request.authContext!.workspaceId),
      isNull(projects.archivedAt),
    ];
    if (status && projects.status.enumValues.includes(status as never)) {
      clauses.push(eq(projects.status, status as typeof projects.status.enumValues[number]));
    }
    const rows = await app.db.select({
      project: projects,
      sourceKind: sources.kind,
      sourceDurationMs: sources.durationMs,
      clipsTotal: sql<number>`coalesce(clip_stats.total, 0)::int`,
      clipsReady: sql<number>`coalesce(clip_stats.ready, 0)::int`,
      momentsFound: sql<number>`coalesce(moment_stats.total, 0)::int`,
    })
      .from(projects)
      .leftJoin(sources, eq(sources.id, projects.sourceId))
      .leftJoin(
        sql`(
          select project_id, count(*) as total, count(*) filter (where status = 'ready') as ready
          from clips
          group by project_id
        ) clip_stats`,
        sql`clip_stats.project_id = ${projects.id}`,
      )
      .leftJoin(
        sql`(
          select ms.project_id, count(*) as total
          from moment_candidates mc
          join moment_searches ms on ms.id = mc.search_id
          where mc.selected = true
          group by ms.project_id
        ) moment_stats`,
        sql`moment_stats.project_id = ${projects.id}`,
      )
      .where(and(...clauses))
      .orderBy(desc(projects.updatedAt))
      .limit(100);
    return {
      items: rows.map((row) => ({
        ...row.project,
        sourceKind: row.sourceKind,
        sourceDurationMs: row.sourceDurationMs,
        clipsTotal: row.clipsTotal,
        clipsReady: row.clipsReady,
        momentsFound: row.momentsFound,
      })),
    };
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
    const [source] = project.sourceId
      ? await app.db.select().from(sources).where(eq(sources.id, project.sourceId)).limit(1)
      : [];
    const [version] = await app.db.select().from(projectVersions)
      .where(and(eq(projectVersions.projectId, project.id), eq(projectVersions.version, project.currentVersion)))
      .limit(1);
    const [transcript] = source
      ? await app.db.select().from(transcripts).where(eq(transcripts.sourceId, source.id)).limit(1)
      : [];
    return {
      project,
      source: source ?? null,
      currentVersion: version ?? null,
      transcript: transcript ? { id: transcript.id, revision: transcript.currentRevision, language: transcript.language } : null,
      moments: candidates,
      clips: projectClips,
    };
  });

  app.get("/v1/projects/:projectId/transcript", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({ project: projects, source: sources, transcript: transcripts })
      .from(projects)
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .innerJoin(transcripts, eq(transcripts.sourceId, sources.id))
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Transcript not found");
    const segments = await app.db.select().from(transcriptSegments)
      .where(eq(transcriptSegments.transcriptId, row.transcript.id))
      .orderBy(transcriptSegments.ordinal);
    return {
      transcript: {
        id: row.transcript.id,
        revision: row.transcript.currentRevision,
        language: row.transcript.language,
      },
      segments,
    };
  });

  app.post("/v1/projects/:projectId/transcript/revisions", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createTranscriptRevisionSchema.parse(request.body);
    const { projectId } = request.params as { projectId: string };
    const { workspaceId, userId } = request.authContext!;
    const revision = await app.db.transaction(async (tx) => {
      const [row] = await tx.select({ transcript: transcripts })
        .from(projects)
        .innerJoin(sources, eq(sources.id, projects.sourceId))
        .innerJoin(transcripts, eq(transcripts.sourceId, sources.id))
        .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (!row) throw app.httpErrors.notFound("Transcript not found");
      if (row.transcript.currentRevision !== body.expectedRevision) {
        throw app.httpErrors.conflict("Transcript was updated in another session");
      }
      const nextRevision = row.transcript.currentRevision + 1;
      const [created] = await tx.insert(transcriptRevisions).values({
        transcriptId: row.transcript.id,
        revision: nextRevision,
        operations: body.operations,
        createdBy: userId,
      }).returning();
      await tx.update(transcripts).set({
        currentRevision: nextRevision,
        updatedAt: new Date(),
      }).where(eq(transcripts.id, row.transcript.id));
      return created;
    });
    return reply.code(201).send({ revision });
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
        let reusableTranscript: typeof transcripts.$inferSelect | null = null;
        // Known only when the source was probed before (reused or uploaded).
        // A fresh YouTube link has no duration until the probe job runs.
        let knownDurationMs: number | null = null;
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
          const [uploadedSource] = await tx.select({ durationMs: sources.durationMs })
            .from(sources)
            .where(eq(sources.id, upload.sourceId))
            .limit(1);
          knownDurationMs = uploadedSource?.durationMs ?? null;
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
        } else if (body.source.kind === "existing") {
          const [source] = await tx.select().from(sources)
            .where(and(eq(sources.id, body.source.sourceId), eq(sources.workspaceId, workspaceId)))
            .limit(1);
          if (!source) throw app.httpErrors.badRequest("Source does not belong to workspace");
          sourceId = source.id;
          knownDurationMs = source.durationMs ?? null;
          const [media] = source.originalMediaId
            ? await tx.select().from(mediaObjects).where(eq(mediaObjects.id, source.originalMediaId)).limit(1)
            : [];
          sourcePayload = media
            ? { kind: "s3", bucket: media.bucket, key: media.objectKey, mimeType: media.mimeType }
            : { kind: source.kind, providerRef: source.providerRef };
          const [transcript] = await tx.select().from(transcripts)
            .where(eq(transcripts.sourceId, source.id))
            .limit(1);
          reusableTranscript = transcript ?? null;
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
          status: reusableTranscript ? "finding_moments" : "probing",
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
          type: reusableTranscript
            ? "find_moments"
            : body.source.kind === "youtube" ? "youtube_import" : "probe",
          class: reusableTranscript ? "provider" : "io",
          payload: reusableTranscript
            ? {
                transcriptId: reusableTranscript.id,
                transcriptRevision: reusableTranscript.currentRevision,
                transcript: reusableTranscript.originalPayload,
                settings: body.momentSettings,
              }
            : { sourceId, source: sourcePayload },
          idempotencyKey: reusableTranscript
            ? `project:${project.id}:moments:v1`
            : `project:${project.id}:probe:v1`,
          // A reused transcript means no re-probe and no second charge for the
          // same source (the UI promises exactly this), so it stays nominal.
          // A real probe/import costs the source's length in seconds, matching
          // how the rest of the pipeline reports cost; an unmeasured YouTube
          // link stays nominal until the probe reports the true duration.
          estimatedCost: reusableTranscript
            ? "1"
            : String(knownDurationMs !== null ? Math.max(knownDurationMs / 1000, 1) : 1),
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

  app.delete("/v1/projects/:projectId", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { workspaceId } = request.authContext!;
    await app.db.transaction(async (tx) => {
      const [project] = await tx.select({
        id: projects.id,
        sourceId: projects.sourceId,
        archivedAt: projects.archivedAt,
      })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (!project) throw app.httpErrors.notFound("Project not found");
      if (project.archivedAt) return;

      const now = new Date();
      await tx.update(projects).set({
        status: "archived",
        archivedAt: now,
        updatedAt: now,
      }).where(eq(projects.id, projectId));
      await tx.update(jobs).set({
        status: "cancelled",
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(jobs.projectId, projectId),
        inArray(jobs.status, ["queued", "leased", "waiting_provider"]),
      ));

      const artifactRows = await tx.select({ mediaObjectId: renderArtifacts.mediaObjectId })
        .from(renderArtifacts)
        .innerJoin(clipVersions, eq(clipVersions.id, renderArtifacts.clipVersionId))
        .innerJoin(clips, eq(clips.id, clipVersions.clipId))
        .where(eq(clips.projectId, projectId));
      const mediaIds = new Set(artifactRows.map((row) => row.mediaObjectId));

      if (project.sourceId) {
        const [otherProject] = await tx.select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.sourceId, project.sourceId),
            ne(projects.id, projectId),
            isNull(projects.archivedAt),
          ))
          .limit(1);
        if (!otherProject) {
          const [source] = await tx.select({
            originalMediaId: sources.originalMediaId,
            proxyMediaId: sources.proxyMediaId,
          }).from(sources)
            .where(and(eq(sources.id, project.sourceId), eq(sources.workspaceId, workspaceId)))
            .limit(1);
          if (source?.originalMediaId) mediaIds.add(source.originalMediaId);
          if (source?.proxyMediaId) mediaIds.add(source.proxyMediaId);
        }
      }

      if (mediaIds.size) {
        await tx.update(mediaObjects)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(
            eq(mediaObjects.workspaceId, workspaceId),
            inArray(mediaObjects.id, [...mediaIds]),
            isNull(mediaObjects.deletedAt),
          ));
      }
    });
    // deletedAt releases logical quota immediately. Physical S3 deletion stays
    // asynchronous, so an active worker holding a short-lived signed URL is not
    // interrupted mid-command. Shared sources remain until their last active
    // project is deleted.
    return reply.code(204).send();
  });

  app.patch("/v1/projects/:projectId/moments/:momentId", { preHandler: app.requireWorkspace }, async (request) => {
    const body = updateMomentSchema.parse(request.body);
    const { projectId, momentId } = request.params as { projectId: string; momentId: string };
    const { workspaceId, userId } = request.authContext!;
    return app.db.transaction(async (tx) => {
      const [moment] = await tx.select({ candidate: momentCandidates })
        .from(momentCandidates)
        .innerJoin(momentSearches, eq(momentSearches.id, momentCandidates.searchId))
        .innerJoin(projects, eq(projects.id, momentSearches.projectId))
        .where(and(
          eq(momentCandidates.id, momentId),
          eq(projects.id, projectId),
          eq(projects.workspaceId, workspaceId),
        ))
        .for("update")
        .limit(1);
      if (!moment) throw app.httpErrors.notFound("Moment not found");
      const [latest] = await tx.select({ revision: max(momentRevisions.revision) })
        .from(momentRevisions)
        .where(eq(momentRevisions.momentCandidateId, momentId));
      const nextRevision = Number(latest?.revision ?? 0) + 1;
      await tx.insert(momentRevisions).values({
        momentCandidateId: momentId,
        revision: nextRevision,
        patch: body,
        createdBy: userId,
      });
      const [updated] = await tx.update(momentCandidates).set({
        selected: body.selected ?? moment.candidate.selected,
        title: body.title ?? moment.candidate.title,
        startMs: body.startMs ?? moment.candidate.startMs,
        endMs: body.endMs ?? moment.candidate.endMs,
        updatedAt: new Date(),
      }).where(eq(momentCandidates.id, momentId)).returning();
      return { moment: updated, revision: nextRevision };
    });
  });

  app.post("/v1/projects/:projectId/moment-searches", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createMomentSearchSchema.parse(request.body);
    const { projectId } = request.params as { projectId: string };
    const key = getIdempotencyKey(request);
    const { workspaceId } = request.authContext!;
    const [project] = await app.db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!project) throw app.httpErrors.notFound("Project not found");
    if (!project.sourceId) throw app.httpErrors.conflict("Project source is not ready");
    const [transcript] = await app.db.select().from(transcripts)
      .where(eq(transcripts.sourceId, project.sourceId))
      .limit(1);
    if (!transcript) throw app.httpErrors.conflict("Transcript is not ready");
    const [job] = await app.db.insert(jobs).values({
      workspaceId,
      projectId,
      type: "find_moments",
      class: "provider",
      payload: {
        transcriptId: transcript.id,
        transcriptRevision: transcript.currentRevision,
        settings: body,
      },
      idempotencyKey: key,
      estimatedCost: "1",
    }).returning();
    await app.db.update(projects).set({ status: "finding_moments", updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    return reply.code(202).send({ job });
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
    const candidates = await app.db.select({ candidate: momentCandidates })
      .from(momentCandidates)
      .innerJoin(momentSearches, eq(momentSearches.id, momentCandidates.searchId))
      .where(and(
        inArray(momentCandidates.id, body.momentIds),
        eq(momentSearches.projectId, projectId),
      ));
    if (candidates.length !== body.momentIds.length) throw app.httpErrors.badRequest("Unknown moment");

    const created = await app.db.transaction(async (tx) => {
      const output = [];
      for (const { candidate } of candidates) {
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

  app.get("/v1/projects/:projectId/clips/:clipId", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({ clip: clips, project: projects, moment: momentCandidates })
      .from(clips)
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .leftJoin(momentCandidates, eq(momentCandidates.id, clips.momentCandidateId))
      .where(and(eq(clips.id, clipId), eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Clip not found");
    const [version] = await app.db.select().from(clipVersions)
      .where(and(eq(clipVersions.clipId, clipId), eq(clipVersions.version, row.clip.currentVersion)))
      .limit(1);
    const artifacts = version
      ? await app.db.select().from(renderArtifacts).where(eq(renderArtifacts.clipVersionId, version.id))
      : [];
    return { ...row, version: version ?? null, artifacts };
  });

  /**
   * Short-lived signed URL for the rendered clip, so the editor can play the
   * real video instead of a placeholder. Returns 404 while the clip has not
   * finished rendering — the editor shows a "still rendering" state rather
   * than pretending there is something to play.
   */
  app.get("/v1/projects/:projectId/clips/:clipId/playback", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({ media: mediaObjects })
      .from(clips)
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(clipVersions, and(
        eq(clipVersions.clipId, clips.id),
        eq(clipVersions.version, clips.currentVersion),
      ))
      .innerJoin(renderArtifacts, and(
        eq(renderArtifacts.clipVersionId, clipVersions.id),
        eq(renderArtifacts.kind, "mp4"),
      ))
      .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
      .where(and(
        eq(clips.id, clipId),
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(mediaObjects.deletedAt),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Rendered clip is not available yet");
    const expiresIn = 900;
    return {
      url: await signDownload(row.media.bucket, row.media.objectKey, expiresIn),
      mimeType: row.media.mimeType,
      expiresIn,
    };
  });

  app.patch("/v1/projects/:projectId/clips/:clipId", { preHandler: app.requireWorkspace }, async (request) => {
    const body = updateClipSchema.parse(request.body);
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId, userId } = request.authContext!;
    return app.db.transaction(async (tx) => {
      const [row] = await tx.select({ clip: clips, project: projects, planCode: workspaces.planCode })
        .from(clips)
        .innerJoin(projects, eq(projects.id, clips.projectId))
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .where(and(eq(clips.id, clipId), eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (!row) throw app.httpErrors.notFound("Clip not found");
      if (row.clip.currentVersion !== body.expectedVersion) {
        throw app.httpErrors.conflict("Clip was updated in another session");
      }
      const edl = clipEdlSchema.parse(body.edl);
      edl.export = clampExportForPlan(edl.export, (row.planCode as PlanCode) ?? "free");
      const nextVersion = row.clip.currentVersion + 1;
      const renderHash = versionHash(edl);
      const [version] = await tx.insert(clipVersions).values({
        clipId,
        version: nextVersion,
        edl,
        renderHash,
        createdBy: userId,
      }).returning();
      const [clip] = await tx.update(clips).set({
        title: body.title ?? row.clip.title,
        socialTitle: body.socialTitle ?? row.clip.socialTitle,
        socialDescription: body.socialDescription ?? row.clip.socialDescription,
        currentVersion: nextVersion,
        status: "draft",
        updatedAt: new Date(),
      }).where(eq(clips.id, clipId)).returning();

      const affectedClipIds = [clipId];
      if (body.scope === "selected_clips" || body.scope === "project") {
        const targetClips = body.scope === "project"
          ? await tx.select().from(clips).where(eq(clips.projectId, projectId))
          : await tx.select().from(clips).where(and(
              eq(clips.projectId, projectId),
              inArray(clips.id, body.selectedClipIds),
            ));
        if (body.scope === "selected_clips" && targetClips.length !== body.selectedClipIds.length) {
          throw app.httpErrors.badRequest("Some selected clips do not belong to the project");
        }
        for (const target of targetClips) {
          if (target.id === clipId) continue;
          const [targetVersion] = await tx.select().from(clipVersions)
            .where(and(eq(clipVersions.clipId, target.id), eq(clipVersions.version, target.currentVersion)))
            .limit(1);
          if (!targetVersion) continue;
          const targetEdl = applyPresentation(clipEdlSchema.parse(targetVersion.edl), edl);
          const targetNextVersion = target.currentVersion + 1;
          await tx.insert(clipVersions).values({
            clipId: target.id,
            version: targetNextVersion,
            edl: targetEdl,
            renderHash: versionHash(targetEdl),
            createdBy: userId,
          });
          await tx.update(clips).set({
            currentVersion: targetNextVersion,
            status: "draft",
            updatedAt: new Date(),
          }).where(eq(clips.id, target.id));
          affectedClipIds.push(target.id);
        }
      }

      if (body.scope === "project") {
        const [projectVersion] = await tx.select().from(projectVersions)
          .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.version, row.project.currentVersion)))
          .limit(1);
        const nextProjectVersion = row.project.currentVersion + 1;
        await tx.insert(projectVersions).values({
          projectId,
          version: nextProjectVersion,
          settings: {
            ...(projectVersion?.settings ?? {}),
            presentationOverride: presentationFromEdl(edl),
          },
          createdBy: userId,
        });
        await tx.update(projects).set({
          currentVersion: nextProjectVersion,
          updatedAt: new Date(),
        }).where(eq(projects.id, projectId));
      }

      let appliedStyleVersionId: string | null = null;
      if (body.scope === "style" || body.scope === "new_style") {
        const [currentStyle] = row.project.styleVersionId
          ? await tx.select({ version: styleVersions, preset: stylePresets })
              .from(styleVersions)
              .innerJoin(stylePresets, eq(stylePresets.id, styleVersions.stylePresetId))
              .where(and(
                eq(styleVersions.id, row.project.styleVersionId),
                eq(stylePresets.workspaceId, workspaceId),
              ))
              .limit(1)
          : [];
        const safeZones = currentStyle
          ? styleConfigSchema.parse(currentStyle.version.config).safeZones
          : ["shorts", "reels", "tiktok", "vk"] as const;
        const config = styleConfigSchema.parse({
          schemaVersion: 1,
          ...presentationFromEdl(edl),
          safeZones,
        });
        if (body.scope === "style") {
          if (!currentStyle) throw app.httpErrors.conflict("Project style is not available");
          const styleNextVersion = currentStyle.preset.currentVersion + 1;
          const [createdStyleVersion] = await tx.insert(styleVersions).values({
            stylePresetId: currentStyle.preset.id,
            version: styleNextVersion,
            config,
            createdBy: userId,
          }).returning();
          await tx.update(stylePresets).set({
            currentVersion: styleNextVersion,
            updatedAt: new Date(),
          }).where(eq(stylePresets.id, currentStyle.preset.id));
          appliedStyleVersionId = createdStyleVersion.id;
        } else {
          const [preset] = await tx.insert(stylePresets).values({
            workspaceId,
            name: body.styleName!,
            description: `Создано из клипа «${clip.title}»`,
          }).returning();
          const [createdStyleVersion] = await tx.insert(styleVersions).values({
            stylePresetId: preset.id,
            version: 1,
            config,
            createdBy: userId,
          }).returning();
          appliedStyleVersionId = createdStyleVersion.id;
        }
        await tx.update(projects).set({
          styleVersionId: appliedStyleVersionId,
          updatedAt: new Date(),
        }).where(eq(projects.id, projectId));
      }

      return {
        clip,
        version,
        scope: body.scope,
        affectedClipIds,
        styleVersionId: appliedStyleVersionId,
      };
    });
  });

  app.post("/v1/projects/:projectId/clips/:clipId/rerender", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const key = getIdempotencyKey(request);
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({
      clip: clips,
      version: clipVersions,
      project: projects,
      source: sources,
      media: mediaObjects,
    }).from(clips)
      .innerJoin(clipVersions, and(
        eq(clipVersions.clipId, clips.id),
        eq(clipVersions.version, clips.currentVersion),
      ))
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .innerJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
      .where(and(eq(clips.id, clipId), eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Clip version is not ready for rerender");
    const edlRange = (row.version.edl as { range?: { startMs?: number; endMs?: number } }).range ?? {};
    const subtitleCues = await buildSubtitleCues(
      app.db,
      row.source.id,
      Number(edlRange.startMs ?? 0),
      Number(edlRange.endMs ?? 0),
    );
    const [job] = await app.db.insert(jobs).values({
      workspaceId,
      projectId,
      clipId,
      type: "render_clip",
      class: "cpu_heavy",
      payload: {
        clipVersionId: row.version.id,
        edl: row.version.edl,
        source: { kind: "s3", bucket: row.media.bucket, key: row.media.objectKey },
        subtitleCues,
      },
      idempotencyKey: key,
      artifactHash: row.version.renderHash,
      estimatedCost: String(Math.max(
        Number((row.version.edl as { range?: { endMs?: number; startMs?: number } }).range?.endMs ?? 0)
          - Number((row.version.edl as { range?: { endMs?: number; startMs?: number } }).range?.startMs ?? 0),
        1,
      ) / 1000),
    }).returning();
    await app.db.update(clips).set({ status: "queued", updatedAt: new Date() }).where(eq(clips.id, clipId));
    return reply.code(202).send({ job });
  });
}
