import { and, asc, desc, eq, gt, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  clipEdlSchema,
  createMomentSearchSchema,
  createProjectSchema,
  createTranscriptRevisionSchema,
  clipDocumentV2Schema,
  updateClipSchema,
  updateMomentSchema,
  updateProjectSchema,
  styleConfigSchema,
} from "../../../../packages/contracts/src/index.js";
import {
  clipVersions,
  clips,
  jobAttempts,
  jobEvents,
  jobRequirements,
  jobs,
  mediaObjects,
  momentCandidates,
  momentRevisions,
  momentSearches,
  projectVersions,
  projectPackages,
  projects,
  renderArtifacts,
  sources,
  stylePresets,
  styleVersions,
  transcriptRevisions,
  transcriptSegments,
  transcripts,
  uploads,
  workerLeases,
  workspaces,
} from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { signDownload } from "../lib/s3.js";
import { runIdempotent } from "../services/idempotency.js";
import { getMinuteBalance } from "../services/minutes.js";
import { buildSubtitleCues } from "../services/subtitles.js";
import { readTimingTranscriptWords } from "../services/transcript.js";
import {
  Hve2PlanNotExecutableError,
  Hve3PlanNotExecutableError,
  Hve5PlanNotExecutableError,
  resolveHve3ExecutionPlan,
  resolveHve5ExecutionPlan,
} from "../services/hve/render-plan.js";
import { materializeHveRenderEdl } from "../services/hve/render-edl.js";
import {
  hveDocumentRequiresPerception,
  hveAssetResolverForPlan,
  loadVerifiedHveRenderAssets,
  renderAssetsForResolvedPlan,
} from "../services/hve/render-input.js";
import { loadVerifiedHvePerceptionContext } from "../services/hve/perception-artifact.js";
import { clampExportForPlan, type PlanCode } from "../../../../packages/product-config/src/index.js";
import { estimateHveProjectExecution, type HveDurationObservation } from "../services/hve-eta.js";
import {
  HVE_ACTIVE_WORKER_WINDOW_MS,
  readHveRuntimeFingerprint,
  selectActiveHveRuntimeFingerprint,
} from "../services/hve-runtime-identity.js";

function preliminaryFingerprint(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function versionHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function packageManifestHash(value: unknown) {
  // The route constructs this manifest in a stable project/clip/artifact
  // order. It is an immutable package identity, not a client-provided hash.
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
    const items = await Promise.all(rows.map(async (row) => {
      const metadata = { ...row.metadata };
      const thumbnail = metadata.thumbnail;
      if (
        thumbnail && typeof thumbnail === "object" && !Array.isArray(thumbnail)
        && typeof (thumbnail as Record<string, unknown>).bucket === "string"
        && typeof (thumbnail as Record<string, unknown>).key === "string"
      ) {
        metadata.thumbnailUrl = await signDownload(
          (thumbnail as Record<string, string>).bucket,
          (thumbnail as Record<string, string>).key,
          15 * 60,
        );
      }
      return { ...row, metadata };
    }));
    return { items };
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
      sourceMetadata: sources.metadata,
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
    const items = await Promise.all(rows.map(async (row) => {
      const metadata = { ...(row.sourceMetadata ?? {}) } as Record<string, unknown>;
      const thumbnail = metadata.thumbnail;
      const sourceThumbnailUrl = typeof metadata.thumbnailUrl === "string"
        ? metadata.thumbnailUrl
        : thumbnail && typeof thumbnail === "object" && !Array.isArray(thumbnail)
          && typeof (thumbnail as Record<string, unknown>).bucket === "string"
          && typeof (thumbnail as Record<string, unknown>).key === "string"
          ? await signDownload(
            (thumbnail as Record<string, string>).bucket,
            (thumbnail as Record<string, string>).key,
            15 * 60,
          )
          : null;
      return {
        ...row.project,
        sourceKind: row.sourceKind,
        sourceDurationMs: row.sourceDurationMs,
        sourceThumbnailUrl,
        clipsTotal: row.clipsTotal,
        clipsReady: row.clipsReady,
        momentsFound: row.momentsFound,
      };
    }));
    return { items };
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
    const [activeJob] = await app.db.select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      checkpoint: jobs.checkpoint,
      startedAt: jobs.startedAt,
      updatedAt: jobs.updatedAt,
    }).from(jobs)
      .where(and(
        eq(jobs.projectId, project.id),
        inArray(jobs.status, ["queued", "leased", "waiting_provider"]),
      ))
      .orderBy(desc(jobs.updatedAt))
      .limit(1);
    const [progressEvent] = activeJob
      ? await app.db.select({ payload: jobEvents.payload, createdAt: jobEvents.createdAt })
        .from(jobEvents)
        .where(and(eq(jobEvents.jobId, activeJob.id), eq(jobEvents.type, "job.progress")))
        .orderBy(desc(jobEvents.id))
        .limit(1)
      : [];
    const responseSource = source ? { ...source, metadata: { ...source.metadata } } : null;
    const sourceThumbnail = responseSource?.metadata.thumbnail;
    if (
      responseSource
      && sourceThumbnail && typeof sourceThumbnail === "object" && !Array.isArray(sourceThumbnail)
      && typeof (sourceThumbnail as Record<string, unknown>).bucket === "string"
      && typeof (sourceThumbnail as Record<string, unknown>).key === "string"
    ) {
      responseSource.metadata.thumbnailUrl = await signDownload(
        (sourceThumbnail as Record<string, string>).bucket,
        (sourceThumbnail as Record<string, string>).key,
        15 * 60,
      );
    }
    return {
      project,
      source: responseSource,
      currentVersion: version ?? null,
      transcript: transcript ? { id: transcript.id, revision: transcript.currentRevision, language: transcript.language } : null,
      processing: activeJob ? {
        type: activeJob.type,
        status: activeJob.status,
        checkpoint: activeJob.checkpoint,
        startedAt: activeJob.startedAt,
        progress: progressEvent?.payload ?? null,
        progressUpdatedAt: progressEvent?.createdAt ?? null,
      } : null,
      moments: candidates,
      clips: projectClips,
    };
  });

  // This is intentionally a narrow operational endpoint. It returns a
  // measured execution range only after enough comparable completed jobs;
  // queue start time stays null until weighted-fair scheduling has a proven
  // calibration model. The dashboard must never turn this into a fake bar.
  app.get("/v1/projects/:projectId/eta", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { workspaceId } = request.authContext!;
    const [project] = await app.db.select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!project) throw app.httpErrors.notFound("Project not found");

    const targetRows = await app.db.select({
      type: jobs.type,
      jobClass: jobs.class,
      estimatedCost: jobs.estimatedCost,
    }).from(jobs).where(and(
      eq(jobs.projectId, projectId),
      sql`${jobs.status} in ('queued', 'leased', 'waiting_provider')`,
    ));
    const observedRows = await app.db.select({
      type: jobs.type,
      jobClass: jobs.class,
      estimatedCost: jobs.estimatedCost,
      metrics: jobAttempts.metrics,
    }).from(jobAttempts)
      .innerJoin(jobs, eq(jobs.id, jobAttempts.jobId))
      .where(eq(jobAttempts.status, "succeeded"))
      .orderBy(desc(jobAttempts.finishedAt))
      .limit(500);
    const observations: HveDurationObservation[] = observedRows.map((row) => {
      const runtimeIdentity = readHveRuntimeFingerprint(row.metrics);
      return {
        type: row.type,
        jobClass: row.jobClass,
        estimatedCost: Number(row.estimatedCost),
        wallSeconds: Number((row.metrics as Record<string, unknown>).wallSeconds),
        ...(runtimeIdentity ? { runtimeFingerprint: runtimeIdentity } : {}),
      };
    });
    // Registration is renewed every 30 seconds by the worker. Two minutes
    // tolerates a short network hiccup while excluding stale pre-deploy rows.
    // If active workers have different runtimes, ETA is deliberately unknown:
    // blending their throughput would present false precision to the user.
    const activeWorkers = await app.db.select({
      metadata: workerLeases.metadata,
      lastHeartbeatAt: workerLeases.lastHeartbeatAt,
    })
      .from(workerLeases)
      .where(gt(workerLeases.lastHeartbeatAt, new Date(Date.now() - HVE_ACTIVE_WORKER_WINDOW_MS)));
    const activeRuntime = selectActiveHveRuntimeFingerprint(activeWorkers);
    return estimateHveProjectExecution(targetRows.map((row) => ({
      type: row.type,
      jobClass: row.jobClass,
      estimatedCost: Number(row.estimatedCost),
    })), observations, {
      mode: "exact_runtime",
      runtimeFingerprint: activeRuntime,
    });
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
          const [preflight] = await tx.select().from(jobs).where(and(
            eq(jobs.id, body.source.preflightJobId),
            eq(jobs.workspaceId, workspaceId),
            eq(jobs.type, "source_preview"),
            eq(jobs.status, "succeeded"),
          )).limit(1);
          const preview = preflight?.result as Record<string, unknown> | null;
          const previewSourceId = typeof preview?.sourceId === "string" ? preview.sourceId : null;
          const durationSeconds = Number(preview?.durationSeconds);
          if (!preflight || previewSourceId !== sourceId || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
            throw app.httpErrors.badRequest("Сначала дождитесь проверки загруженного файла");
          }
          const selectedSeconds = body.momentSettings.sourceRange
            ? body.momentSettings.sourceRange.endSeconds - body.momentSettings.sourceRange.startSeconds
            : durationSeconds;
          if (body.momentSettings.sourceRange && body.momentSettings.sourceRange.endSeconds > durationSeconds) {
            throw app.httpErrors.badRequest("Выбранный диапазон выходит за длительность видео");
          }
          const balance = await getMinuteBalance(tx, workspaceId);
          if (balance.availableSeconds < selectedSeconds) {
            throw app.httpErrors.conflict("Кредитов не хватает на выбранный диапазон. Сократите его или пополните баланс.");
          }
          knownDurationMs = durationSeconds * 1000;
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
          const normalizedUrl = new URL(body.source.url).toString();
          const [preflight] = await tx.select().from(jobs).where(and(
            eq(jobs.id, body.source.preflightJobId),
            eq(jobs.workspaceId, workspaceId),
            eq(jobs.type, "source_preview"),
            eq(jobs.status, "succeeded"),
          )).limit(1);
          const preview = preflight?.result as Record<string, unknown> | null;
          const previewUrl = typeof preview?.url === "string" ? preview.url : null;
          const durationSeconds = Number(preview?.durationSeconds);
          if (!preflight || previewUrl !== normalizedUrl || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
            throw app.httpErrors.badRequest("Сначала проверьте ссылку, чтобы узнать длительность и стоимость");
          }
          const selectedSeconds = body.momentSettings.sourceRange
            ? body.momentSettings.sourceRange.endSeconds - body.momentSettings.sourceRange.startSeconds
            : durationSeconds;
          if (body.momentSettings.sourceRange && body.momentSettings.sourceRange.endSeconds > durationSeconds) {
            throw app.httpErrors.badRequest("Выбранный диапазон выходит за длительность видео");
          }
          const balance = await getMinuteBalance(tx, workspaceId);
          if (balance.availableSeconds < selectedSeconds) {
            throw app.httpErrors.conflict("Кредитов не хватает на выбранный диапазон. Сократите его или пополните баланс.");
          }
          const [source] = await tx.insert(sources).values({
            workspaceId,
            kind: "youtube",
            providerRef: normalizedUrl,
            durationMs: durationSeconds * 1000,
            metadata: {
              preliminaryFingerprint: preliminaryFingerprint(normalizedUrl),
              title: typeof preview?.title === "string" ? preview.title : body.title,
              authorName: typeof preview?.authorName === "string" ? preview.authorName : null,
              thumbnailUrl: typeof preview?.thumbnailUrl === "string" ? preview.thumbnailUrl : null,
              preflightJobId: preflight.id,
            },
          }).returning();
          sourceId = source.id;
          knownDurationMs = durationSeconds * 1000;
          sourcePayload = { kind: "youtube", url: normalizedUrl };
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
            : String(body.momentSettings.sourceRange
              ? body.momentSettings.sourceRange.endSeconds - body.momentSettings.sourceRange.startSeconds
              : knownDurationMs !== null ? Math.max(knownDurationMs / 1000, 1) : 1),
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
      await tx.update(projectPackages).set({
        status: "cancelled",
        updatedAt: now,
      }).where(and(
        eq(projectPackages.projectId, projectId),
        inArray(projectPackages.status, ["queued", "processing"]),
      ));

      const artifactRows = await tx.select({ mediaObjectId: renderArtifacts.mediaObjectId })
        .from(renderArtifacts)
        .innerJoin(clipVersions, eq(clipVersions.id, renderArtifacts.clipVersionId))
        .innerJoin(clips, eq(clips.id, clipVersions.clipId))
        .where(eq(clips.projectId, projectId));
      const mediaIds = new Set(artifactRows.map((row) => row.mediaObjectId));
      const packageRows = await tx.select({ mediaObjectId: projectPackages.mediaObjectId })
        .from(projectPackages)
        .where(eq(projectPackages.projectId, projectId));
      for (const packageRow of packageRows) {
        if (packageRow.mediaObjectId) mediaIds.add(packageRow.mediaObjectId);
      }

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
    if (!project.sourceId) throw app.httpErrors.conflict("Project source is not ready");
    if (!project.styleVersionId) throw app.httpErrors.conflict("Project style is not configured");
    const [renderSource] = await app.db.select({
      source: sources,
      media: mediaObjects,
      style: styleVersions,
    }).from(sources)
      .innerJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
      .innerJoin(styleVersions, eq(styleVersions.id, project.styleVersionId))
      .where(and(eq(sources.id, project.sourceId), eq(sources.workspaceId, workspaceId)))
      .limit(1);
    if (!renderSource) throw app.httpErrors.conflict("Source media or style is not ready");
    const renderStyle = styleConfigSchema.parse(renderSource.style.config);
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
          payload: {
            clipId: clip.id,
            momentId: candidate.id,
            requestedBy: userId,
            source: {
              kind: "s3",
              bucket: renderSource.media.bucket,
              key: renderSource.media.objectKey,
            },
            range: { startMs: candidate.startMs, endMs: candidate.endMs },
            export: renderStyle.export,
            layout: renderStyle.layout,
          },
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

  /** Download a retained render sidecar without exposing its object key. */
  app.get("/v1/projects/:projectId/clips/:clipId/artifacts/:kind", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId, kind } = request.params as { projectId: string; clipId: string; kind: string };
    if (kind !== "mp4" && kind !== "srt" && kind !== "vtt") throw app.httpErrors.notFound("Artifact type is not available");
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({ media: mediaObjects, artifact: renderArtifacts })
      .from(clips)
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(clipVersions, and(
        eq(clipVersions.clipId, clips.id),
        eq(clipVersions.version, clips.currentVersion),
      ))
      .innerJoin(renderArtifacts, and(
        eq(renderArtifacts.clipVersionId, clipVersions.id),
        eq(renderArtifacts.kind, kind),
      ))
      .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
      .where(and(
        eq(clips.id, clipId),
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(mediaObjects.deletedAt),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Rendered artifact is not available yet");
    const expiresIn = 900;
    return {
      url: await signDownload(row.media.bucket, row.media.objectKey, expiresIn),
      mimeType: row.media.mimeType,
      expiresIn,
      kind,
    };
  });

  /**
   * Snapshot every currently ready clip into one immutable ZIP task. The
   * manifest pins current clip versions and their actual retained objects, so
   * rerenders finishing later never mutate a package already requested.
   */
  app.post("/v1/projects/:projectId/packages", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { workspaceId, userId } = request.authContext!;
    const key = getIdempotencyKey(request);
    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key,
      body: { projectId, operation: "create_project_package" },
      statusCode: 202,
      execute: async (tx) => {
        const [project] = await tx.select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), isNull(projects.archivedAt)))
          .for("update")
          .limit(1);
        if (!project) throw app.httpErrors.notFound("Project not found");
        const rows = await tx.select({
          clipId: clips.id,
          title: clips.title,
          versionId: clipVersions.id,
          version: clipVersions.version,
          kind: renderArtifacts.kind,
          bucket: mediaObjects.bucket,
          objectKey: mediaObjects.objectKey,
          byteSize: mediaObjects.byteSize,
          sha256: mediaObjects.sha256,
          mediaDeletedAt: mediaObjects.deletedAt,
        })
          .from(clips)
          .innerJoin(clipVersions, and(
            eq(clipVersions.clipId, clips.id),
            eq(clipVersions.version, clips.currentVersion),
          ))
          .innerJoin(renderArtifacts, eq(renderArtifacts.clipVersionId, clipVersions.id))
          .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
          .where(and(eq(clips.projectId, projectId), eq(clips.status, "ready"), isNull(mediaObjects.deletedAt)))
          .orderBy(asc(clips.createdAt), asc(renderArtifacts.kind));

        const byClip = new Map<string, {
          clipId: string;
          title: string;
          clipVersionId: string;
          version: number;
          artifacts: Array<{ kind: "mp4" | "srt" | "vtt"; bucket: string; key: string; byteSize: number; sha256?: string }>;
        }>();
        for (const row of rows) {
          if (row.kind !== "mp4" && row.kind !== "srt" && row.kind !== "vtt") continue;
          const item = byClip.get(row.clipId) ?? {
            clipId: row.clipId,
            title: row.title,
            clipVersionId: row.versionId,
            version: row.version,
            artifacts: [],
          };
          item.artifacts.push({
            kind: row.kind,
            bucket: row.bucket,
            key: row.objectKey,
            byteSize: row.byteSize,
            ...(row.sha256 && /^[a-f0-9]{64}$/.test(row.sha256) ? { sha256: row.sha256 } : {}),
          });
          byClip.set(row.clipId, item);
        }
        const manifest = {
          schemaVersion: 1,
          projectId,
          items: [...byClip.values()]
            .filter((item) => item.artifacts.some((artifact) => artifact.kind === "mp4"))
            .map((item) => ({
              ...item,
              artifacts: item.artifacts.sort((left, right) => ["mp4", "srt", "vtt"].indexOf(left.kind) - ["mp4", "srt", "vtt"].indexOf(right.kind)),
            })),
        };
        if (!manifest.items.length) throw app.httpErrors.conflict("No ready clips are available for a package yet");
        const manifestHash = packageManifestHash(manifest);
        const [existing] = await tx.select().from(projectPackages)
          .where(and(eq(projectPackages.projectId, projectId), eq(projectPackages.manifestHash, manifestHash)))
          .limit(1);
        if (existing) {
          if (existing.status !== "failed") return { package: existing, reused: true };
          // A terminal packaging error may be retried without re-rendering.
          // It reuses the exact immutable artifact manifest, but not the old
          // exhausted job idempotency key.
          const [retryJob] = await tx.insert(jobs).values({
            workspaceId,
            projectId,
            type: "zip_project",
            class: "io",
            payload: { packageId: existing.id, manifestHash, items: manifest.items },
            idempotencyKey: `project:${projectId}:package:${manifestHash}:retry:${existing.updatedAt.getTime()}`,
            artifactHash: manifestHash,
            estimatedCost: String(Math.max(manifest.items.length, 1)),
          }).returning();
          await tx.insert(jobRequirements).values({
            jobId: retryJob.id,
            requirements: {
              requiredClasses: ["io"], requiredJobTypes: ["zip_project"], requiredModels: {},
              minimumRamBytes: 0, minimumScratchBytes: 0, workspaceConcurrencyLimit: 1,
            },
          });
          const [retriedPackage] = await tx.update(projectPackages).set({
            jobId: retryJob.id,
            status: "queued",
            error: null,
            updatedAt: new Date(),
          }).where(eq(projectPackages.id, existing.id)).returning();
          return { package: retriedPackage, reused: false };
        }

        const [projectPackage] = await tx.insert(projectPackages).values({
          workspaceId,
          projectId,
          manifestHash,
          manifest,
          createdBy: userId,
        }).returning();
        const [job] = await tx.insert(jobs).values({
          workspaceId,
          projectId,
          type: "zip_project",
          class: "io",
          payload: {
            packageId: projectPackage.id,
            manifestHash,
            items: manifest.items,
          },
          idempotencyKey: `project:${projectId}:package:${manifestHash}`,
          artifactHash: manifestHash,
          estimatedCost: String(Math.max(manifest.items.length, 1)),
        }).returning();
        await tx.insert(jobRequirements).values({
          jobId: job.id,
          requirements: {
            requiredClasses: ["io"],
            requiredJobTypes: ["zip_project"],
            requiredModels: {},
            minimumRamBytes: 0,
            minimumScratchBytes: 0,
            workspaceConcurrencyLimit: 1,
          },
        });
        const [updatedPackage] = await tx.update(projectPackages).set({ jobId: job.id, updatedAt: new Date() })
          .where(eq(projectPackages.id, projectPackage.id)).returning();
        return { package: updatedPackage, reused: false };
      },
    });
    return reply.code(result.replayed || result.value.reused ? 200 : 202).send(result.value);
  });

  app.get("/v1/projects/:projectId/packages/:packageId", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, packageId } = request.params as { projectId: string; packageId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({ projectPackage: projectPackages, media: mediaObjects })
      .from(projectPackages)
      .leftJoin(mediaObjects, eq(mediaObjects.id, projectPackages.mediaObjectId))
      .where(and(
        eq(projectPackages.id, packageId),
        eq(projectPackages.projectId, projectId),
        eq(projectPackages.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Project package not found");
    const expiresIn = row.projectPackage.status === "ready" && row.media && !row.media.deletedAt
      ? 900
      : undefined;
    return {
      package: row.projectPackage,
      ...(expiresIn && row.media ? {
        download: {
          url: await signDownload(row.media.bucket, row.media.objectKey, expiresIn),
          mimeType: row.media.mimeType,
          expiresIn,
        },
      } : {}),
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
    let renderEdl = clipEdlSchema.parse(row.version.edl);
    const edlRange = renderEdl.range;
    let subtitleCues = await buildSubtitleCues(
      app.db,
      row.source.id,
      Number(edlRange.startMs ?? 0),
      Number(edlRange.endMs ?? 0),
      typeof (row.version.edl as { transcriptRevision?: unknown }).transcriptRevision === "number"
        ? Number((row.version.edl as { transcriptRevision: number }).transcriptRevision)
        : undefined,
    );
    let resolvedPlan: Record<string, unknown> | undefined;
    let renderAssets: Array<Record<string, unknown>> = [];
    if (row.version.documentV2) {
      const document = clipDocumentV2Schema.parse(row.version.documentV2);
      if (document.sourceRefs.length !== 1 || document.sourceRefs[0]?.sourceId !== row.source.id) {
        throw app.httpErrors.conflict("HVE-2 document does not match this clip source");
      }
      try {
        // A V2 document must rerender through the same compositor planner as
        // its editor commit.  Using the old HVE-2 adapter here would silently
        // discard resolved layout/text layers and resurrect the old EDL
        // subtitle styling.
        const staticAssets = await loadVerifiedHveRenderAssets({
          db: app.db,
          workspaceId,
          document,
        });
        const requiresPerception = hveDocumentRequiresPerception(document);
        let perceptionContext = null;
        if (requiresPerception) {
          if (!row.source.fingerprint) throw app.httpErrors.conflict("HVE5_SOURCE_FINGERPRINT_REQUIRED");
          try {
            perceptionContext = await loadVerifiedHvePerceptionContext({
              db: app.db,
              workspaceId,
              sourceId: row.source.id,
              sourceHash: row.source.fingerprint,
              analysisId: document.analysisId,
              probe: (row.source.metadata as { probe?: unknown }).probe,
            });
          } catch {
            // An artifact hash/manifest mismatch must be visible as an
            // actionable unavailable-analysis state, never as a 500 and never
            // as a silent static-crop fallback.
            throw app.httpErrors.conflict("HVE5_ANALYSIS_ARTIFACT_INVALID");
          }
          if (!perceptionContext) throw app.httpErrors.conflict("HVE5_ANALYSIS_ARTIFACT_REQUIRED");
        }
        const transcriptWords = await readTimingTranscriptWords(app.db, row.source.id);
        const execution = requiresPerception
          ? await resolveHve5ExecutionPlan(document, transcriptWords, perceptionContext!, hveAssetResolverForPlan(staticAssets))
          : await resolveHve3ExecutionPlan(document, transcriptWords, hveAssetResolverForPlan(staticAssets));
        resolvedPlan = execution.resolvedPlan;
        subtitleCues = execution.subtitleCues;
        renderEdl = materializeHveRenderEdl(document, renderEdl);
        renderAssets = renderAssetsForResolvedPlan(execution.resolvedPlan, staticAssets);
      } catch (error) {
        if (error instanceof Hve2PlanNotExecutableError || error instanceof Hve3PlanNotExecutableError || error instanceof Hve5PlanNotExecutableError) {
          throw app.httpErrors.conflict(`${error.code}: ${error.message}`);
        }
        if (error instanceof Error && [
          "HVE_ASSET_NOT_AVAILABLE",
          "HVE_BRAND_ASSET_INVALID",
          "HVE5_ANALYSIS_ARTIFACT_REQUIRED",
          "HVE5_ANALYSIS_ARTIFACT_INVALID",
          "HVE5_SOURCE_FINGERPRINT_REQUIRED",
        ].includes(error.message)) throw app.httpErrors.conflict(error.message);
        throw error;
      }
    }
    const probe = row.source.metadata.probe;
    const sourceHasAudio = typeof probe === "object" && probe !== null && !Array.isArray(probe)
      && "audio" in probe && Boolean(probe.audio);
    const [job] = await app.db.insert(jobs).values({
      workspaceId,
      projectId,
      clipId,
      type: "render_clip",
      class: "cpu_heavy",
      payload: {
        clipVersionId: row.version.id,
        edl: renderEdl,
        source: { kind: "s3", bucket: row.media.bucket, key: row.media.objectKey },
        sourceHasAudio,
        subtitleCues,
        ...(resolvedPlan ? { resolvedPlan } : {}),
        ...(renderAssets.length ? { renderAssets } : {}),
      },
      idempotencyKey: key,
      artifactHash: row.version.renderHash,
      estimatedCost: String(Math.max(
        Number(renderEdl.range.endMs) - Number(renderEdl.range.startMs),
        1,
      ) / 1000),
    }).returning();
    await app.db.update(clips).set({ status: "queued", updatedAt: new Date() }).where(eq(clips.id, clipId));
    return reply.code(202).send({ job });
  });
}
