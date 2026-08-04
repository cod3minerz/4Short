import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  applyEditorCommandBatchSchema,
  applyEditorDraftCommands,
  clipDraftMetadataSchema,
  clipDocumentV2Schema,
  clipEdlSchema,
  commitEditorDraftSchema,
  directLayouts,
  faceTracksCoveringSourceRange,
  hashHve,
  HveFontNotExecutableError,
} from "../../../../packages/contracts/src/index.js";
import {
  clipDrafts,
  clipVersions,
  clips,
  editorCommandBatches,
  jobs,
  jobRequirements,
  mediaObjects,
  momentCandidates,
  projects,
  renderArtifacts,
  sources,
  sourceAnalyses,
  workspaces,
} from "../../../../db/schema.js";
import { productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import { getIdempotencyKey } from "../lib/http.js";
import { signDownload } from "../lib/s3.js";
import { verifySignedBrowserMediaAccess } from "../lib/browser-media-contract.js";
import { getEnv } from "../env.js";
import { runIdempotent } from "../services/idempotency.js";
import { resolveHve3ExecutionPlan, resolveHve5ExecutionPlan, resolveHveEditorSequencePlan, resolveHveEditorVisualPreviewPlan, Hve2PlanNotExecutableError, Hve3PlanNotExecutableError, Hve5PlanNotExecutableError } from "../services/hve/render-plan.js";
import { materializeHveRenderEdl } from "../services/hve/render-edl.js";
import {
  hveDocumentRequiresPerception,
  hveAssetResolverForPlan,
  loadVerifiedHveRenderAssets,
  renderAssetsForResolvedPlan,
  type RenderAssetInput,
} from "../services/hve/render-input.js";
import { selectEditorPreview } from "../services/hve/editor-manifest.js";
import { readTimingTranscriptWords } from "../services/transcript.js";
import { loadVerifiedHvePerceptionContext } from "../services/hve/perception-artifact.js";
import { isAdmissibleRenderCacheCandidate } from "../services/render-cache.js";

type DraftResponse = {
  clipId: string;
  baseVersion: number;
  revision: number;
  document: Record<string, unknown>;
  documentHash: string;
  metadata: { title: string; socialTitle: string | null; socialDescription: string | null };
  updatedAt: string;
  updatedBy: string;
};

function serializeDraft(draft: typeof clipDrafts.$inferSelect): DraftResponse {
  return {
    clipId: draft.clipId,
    baseVersion: draft.baseVersion,
    revision: draft.revision,
    document: draft.document,
    documentHash: draft.documentHash,
    metadata: clipDraftMetadataSchema.parse(draft.metadata),
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

function stableUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function denseClipPerceptionAnalysisId(clipId: string, sourceId: string, sourceHash: string, range: { startMs: number; endMs: number }) {
  return stableUuid([
    "hve5-dense-clip-v1", clipId, sourceId, sourceHash, range.startMs, range.endMs,
  ].join(":"));
}

/**
 * A render artifact is shared only within a workspace and only while its
 * object remains both retained and validated. Keeping this calculation here
 * makes editor commits follow the same retention promise as the initial
 * render pipeline without exposing plan details to the browser.
 */
async function clipArtifactExpiry(
  db: FastifyInstance["db"],
  workspaceId: string,
) {
  const [workspace] = await db.select({ planCode: workspaces.planCode })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const planCode = workspace?.planCode && workspace.planCode in productPlans
    ? workspace.planCode as PlanCode
    : "free";
  return new Date(Date.now() + productPlans[planCode].outputRetentionDays * 24 * 60 * 60 * 1_000);
}

function sourceMediaFacts(probe: unknown, durationMs: number) {
  const record = probe && typeof probe === "object" && !Array.isArray(probe)
    ? probe as { video?: Record<string, unknown>; audio?: unknown }
    : {};
  const video = record.video ?? {};
  const [numeratorRaw, denominatorRaw] = String(video.avg_frame_rate ?? video.r_frame_rate ?? "30/1").split("/", 2);
  const rotationCandidate = Number(video.rotation ?? 0);
  return {
    durationUs: durationMs * 1_000,
    width: Math.max(1, Number(video.width ?? 1)),
    height: Math.max(1, Number(video.height ?? 1)),
    frameRate: {
      numerator: Math.max(1, Number.parseInt(numeratorRaw, 10) || 30),
      denominator: Math.max(1, Number.parseInt(denominatorRaw, 10) || 1),
    },
    rotationDegrees: ([0, 90, 180, 270].includes(rotationCandidate) ? rotationCandidate : 0) as 0 | 90 | 180 | 270,
    hasAudio: Boolean(record.audio),
  };
}

function rangesCoverSourceInterval(
  ranges: Array<{ range: { startUs: number; endUs: number } }>,
  target: { startUs: number; endUs: number },
) {
  const intervals = ranges
    .map((item) => item.range)
    .filter((range) => range.endUs > target.startUs && range.startUs < target.endUs)
    .map((range) => ({ startUs: Math.max(range.startUs, target.startUs), endUs: Math.min(range.endUs, target.endUs) }))
    .sort((left, right) => left.startUs - right.startUs);
  let cursor = target.startUs;
  for (const interval of intervals) {
    if (interval.startUs > cursor) return false;
    cursor = Math.max(cursor, interval.endUs);
    if (cursor >= target.endUs) return true;
  }
  return false;
}

/**
 * HVE-4 draft persistence. These routes are intentionally internal until the
 * focus editor is feature-gated: saving a draft has no queue or render side
 * effect. A separate immutable-version command will be introduced only after
 * HVE-3 execution and editor evidence are production-ready.
 */
export async function editorRoutes(app: FastifyInstance) {
  /**
   * Bootstrap data for the future native HVE sequence player. This is a
   * source-review URL only: the browser must map it through the draft's
   * resolved plan before drawing composition overlays. It never claims the
   * raw source is a final render and never exposes bucket/key fields.
   */
  app.get("/v1/projects/:projectId/clips/:clipId/editor-manifest", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId } = request.authContext!;
    const now = new Date();
    const [row] = await app.db.select({
      clip: clips,
      project: projects,
      source: sources,
      version: clipVersions,
      original: mediaObjects,
    }).from(clips)
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .innerJoin(clipVersions, and(
        eq(clipVersions.clipId, clips.id),
        eq(clipVersions.version, clips.currentVersion),
      ))
      .leftJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
      .where(and(
        eq(clips.id, clipId),
        eq(clips.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Clip not found");
    if (!row.version.documentV2) {
      throw app.httpErrors.conflict("HVE v2 editor document is not available for this clip");
    }
    const immutableDocument = clipDocumentV2Schema.parse(row.version.documentV2);
    if (immutableDocument.clipId !== row.clip.id || immutableDocument.sourceRefs.length !== 1 || immutableDocument.sourceRefs[0]?.sourceId !== row.source.id) {
      throw app.httpErrors.conflict("HVE v2 document does not match the selected clip source");
    }

    // The source review is allowed to use the saved draft clock when it is
    // based on the currently selected immutable clip version. A stale draft
    // never hijacks another tab's review. This query intentionally returns no
    // media identity other than the already authorised source URL below.
    const [draft] = await app.db.select().from(clipDrafts).where(and(
      eq(clipDrafts.clipId, row.clip.id),
      eq(clipDrafts.workspaceId, workspaceId),
      eq(clipDrafts.baseVersion, row.version.version),
    )).limit(1);
    const candidateDocument = draft ? clipDocumentV2Schema.parse(draft.document) : immutableDocument;
    if (candidateDocument.clipId !== row.clip.id || candidateDocument.sourceRefs.length !== 1 || candidateDocument.sourceRefs[0]?.sourceId !== row.source.id) {
      throw app.httpErrors.conflict("HVE editor draft does not match the selected clip source");
    }

    let sequence: {
      status: "ready";
      documentHash: string;
      outputDurationUs: number;
      timeMap: Awaited<ReturnType<typeof resolveHveEditorSequencePlan>>["timeMap"];
      previewMode: Awaited<ReturnType<typeof resolveHveEditorSequencePlan>>["previewMode"];
    } | { status: "unavailable"; reason: "transcript_timing_unavailable" | "invalid_timing_plan" };
    try {
      const transcriptWords = await readTimingTranscriptWords(app.db, row.source.id);
      const resolvedSequence = await resolveHveEditorSequencePlan(candidateDocument, transcriptWords);
      sequence = { status: "ready", ...resolvedSequence };
    } catch (error) {
      request.log.warn({ error, clipId, projectId }, "HVE editor source-review sequence is unavailable");
      sequence = {
        status: "unavailable",
        reason: "transcript_timing_unavailable",
      };
    }

    // Composition preview is a deliberately stricter subset than source
    // sequence review. It is only enabled when the browser can draw the same
    // resolved source-slot geometry without receiving a private asset or
    // inventing a tracking/blur fallback. The final renderer remains the
    // authority for glyph parity and any richer composition.
    let composition: {
      status: "ready";
      documentHash: string;
      resolvedPlan: Awaited<ReturnType<typeof resolveHveEditorVisualPreviewPlan>>["resolvedPlan"];
      captionStyle: Awaited<ReturnType<typeof resolveHveEditorVisualPreviewPlan>>["captionStyle"];
    } | {
      status: "unavailable";
      reason: "perception_required" | "private_asset_required" | "blur_layout_unsupported" | "plan_unavailable";
    };
    try {
      const transcriptWords = await readTimingTranscriptWords(app.db, row.source.id);
      const visual = await resolveHveEditorVisualPreviewPlan(candidateDocument, transcriptWords);
      composition = { status: "ready", ...visual };
    } catch (error) {
      const code = error instanceof Hve3PlanNotExecutableError ? error.code : "";
      const reason = code === "HVE_EDITOR_PREVIEW_PERCEPTION_REQUIRED"
        ? "perception_required"
        : code === "HVE_EDITOR_PREVIEW_PRIVATE_ASSET_REQUIRED"
          ? "private_asset_required"
          : code === "HVE_EDITOR_PREVIEW_BLUR_UNSUPPORTED"
            ? "blur_layout_unsupported"
            : "plan_unavailable";
      request.log.debug({ error, clipId, projectId, reason }, "HVE editor composition preview is unavailable");
      composition = { status: "unavailable", reason };
    }

    const [proxy] = row.source.proxyMediaId
      ? await app.db.select().from(mediaObjects).where(and(
          eq(mediaObjects.id, row.source.proxyMediaId),
          eq(mediaObjects.workspaceId, workspaceId),
        )).limit(1)
      : [];
    const isUsable = (media: typeof mediaObjects.$inferSelect | null) => Boolean(
      media && !media.deletedAt && (!media.expiresAt || media.expiresAt > now),
    );
    const selection = selectEditorPreview({
      proxy: proxy ? { id: proxy.id, mimeType: proxy.mimeType, usable: isUsable(proxy) } : null,
      original: row.original ? { id: row.original.id, mimeType: row.original.mimeType, usable: isUsable(row.original) } : null,
      probe: (row.source.metadata as { probe?: unknown }).probe as { browserCompatible?: unknown; video?: { codec_name?: unknown } | null; audio?: { codec_name?: unknown } | null } | undefined,
    });
    const base = {
      schemaVersion: 1 as const,
      clipId: row.clip.id,
      baseVersion: row.version.version,
      documentHash: draft?.documentHash ?? row.version.documentHash ?? await hashHve(immutableDocument),
      previewPurpose: "source_review_only" as const,
      sourceDurationUs: row.source.durationMs ? row.source.durationMs * 1_000 : null,
      sequence,
      composition,
    };
    if (selection.status !== "ready") return { ...base, preview: selection };
    const media = selection.mediaId === proxy?.id ? proxy : row.original;
    // The selector proves this is a retained and browser-compatible media
    // object; keep a final guard here so a concurrent lifecycle sweep cannot
    // accidentally sign a stale object.
    if (!media || !isUsable(media)) return { ...base, preview: { status: "pending_proxy" as const, reason: "source_media_unavailable" as const } };
    const expiresIn = 900;
    const url = await signDownload(media.bucket, media.objectKey, expiresIn);
    const browserAccess = await verifySignedBrowserMediaAccess({
      url,
      origin: new URL(getEnv().WEB_ORIGIN).origin,
    });
    if (browserAccess.status !== "ready") {
      request.log.warn({ clipId, projectId, reason: browserAccess.reason }, "HVE editor browser media contract is unavailable");
      return {
        ...base,
        preview: {
          status: "pending_proxy" as const,
          reason: "browser_media_contract_unavailable" as const,
        },
      };
    }
    return {
      ...base,
      preview: {
        status: "ready" as const,
        source: selection.source,
        url,
        mimeType: media.mimeType,
        expiresIn,
      },
    };
  });

  /**
   * Returns an advisory composition plan for this exact source interval. It
   * never writes a draft, starts a render or upgrades sparse perception. The
   * editor may show this as a suggestion only; applying a layout stays an
   * explicit, versioned editor command.
   */
  app.get("/v1/projects/:projectId/clips/:clipId/layout-recommendation", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId } = request.authContext!;
    // The directLayouts primitive stays available to the evaluator and
    // internal verification path, but it is never a public product claim by
    // default. A sparse face graph is useful evidence for a manual picker;
    // it is not proof that HVE recognised gameplay, a screen or the correct
    // participant order. Do this before reading artifacts so a disabled
    // capability cannot leak a tempting automatic-layout recommendation.
    if (!getEnv().HVE_AUTOMATIC_LAYOUT_DIRECTOR_ENABLED) {
      return { status: "unavailable" as const, reason: "automatic_layout_evidence_not_approved" as const };
    }
    const [row] = await app.db.select({
      clip: clips,
      moment: momentCandidates,
      project: projects,
      source: sources,
    }).from(clips)
      .innerJoin(momentCandidates, eq(momentCandidates.id, clips.momentCandidateId))
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .where(and(
        eq(clips.id, clipId),
        eq(clips.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Clip not found");
    if (!row.source.fingerprint || !row.source.durationMs
      || row.moment.startMs < 0 || row.moment.endMs <= row.moment.startMs
      || row.moment.endMs > row.source.durationMs) {
      return { status: "unavailable" as const, reason: "source_or_range_not_ready" };
    }

    const analyses = await app.db.select({ id: sourceAnalyses.id })
      .from(sourceAnalyses)
      .where(and(
        eq(sourceAnalyses.workspaceId, workspaceId),
        eq(sourceAnalyses.sourceId, row.source.id),
        eq(sourceAnalyses.sourceHash, row.source.fingerprint),
        eq(sourceAnalyses.status, "succeeded"),
      ))
      .orderBy(desc(sourceAnalyses.completedAt), desc(sourceAnalyses.createdAt))
      // A project can have one sparse source pass and several independent
      // dense clip passes. Bound the lookup; source-wide evidence normally
      // wins but an unrelated dense pass must not become a false layout fact.
      .limit(20);
    if (!analyses.length) return { status: "unavailable" as const, reason: "visual_evidence_pending" };

    const sourceRange = { startUs: row.moment.startMs * 1_000, endUs: row.moment.endMs * 1_000 };
    let rejectedEvidence = false;
    for (const analysis of analyses) {
      try {
        const context = await loadVerifiedHvePerceptionContext({
          db: app.db,
          workspaceId,
          sourceId: row.source.id,
          sourceHash: row.source.fingerprint,
          analysisId: analysis.id,
          probe: (row.source.metadata as { probe?: unknown }).probe,
        });
        if (!context || !rangesCoverSourceInterval(context.graph.classifications, sourceRange)) continue;
        return {
          status: "ready" as const,
          analysisId: context.analysisId,
          recommendation: directLayouts(context.graph, { sourceRange }),
        };
      } catch (error) {
        rejectedEvidence = true;
        request.log.warn({ error, clipId, projectId, analysisId: analysis.id }, "HVE director evidence rejected");
      }
    }
    return { status: "unavailable" as const, reason: rejectedEvidence ? "visual_evidence_rejected" : "visual_evidence_pending" };
  });

  /**
   * HVE-5.1 dense perception is opt-in and range-bounded. The focus editor
   * will call this only when a user explicitly asks for a face crop track;
   * normal project creation never queues it. The range is deliberately read
   * from the server-side moment candidate, not accepted from the browser.
   */
  app.post("/v1/projects/:projectId/clips/:clipId/perception", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({
      clip: clips,
      moment: momentCandidates,
      project: projects,
      source: sources,
      media: mediaObjects,
      workspace: workspaces,
    }).from(clips)
      .innerJoin(momentCandidates, eq(momentCandidates.id, clips.momentCandidateId))
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .innerJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(and(
        eq(clips.id, clipId),
        eq(clips.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Clip not found");
    if (!row.source.fingerprint || !row.source.durationMs) {
      throw app.httpErrors.conflict("HVE5_SOURCE_NOT_READY");
    }
    const probe = (row.source.metadata as { probe?: unknown }).probe;
    if (!probe || row.moment.startMs < 0 || row.moment.endMs <= row.moment.startMs || row.moment.endMs > row.source.durationMs) {
      throw app.httpErrors.conflict("HVE5_CLIP_RANGE_NOT_READY");
    }
    const range = { startMs: row.moment.startMs, endMs: row.moment.endMs };
    const analysisId = denseClipPerceptionAnalysisId(row.clip.id, row.source.id, row.source.fingerprint, range);
    const planCode = (row.workspace.planCode in productPlans ? row.workspace.planCode : "free") as PlanCode;
    const [job] = await app.db.insert(jobs).values({
      workspaceId,
      projectId,
      clipId,
      type: "analyze_clip_visual",
      class: "cpu_medium",
      payload: {
        analysisId,
        sourceId: row.source.id,
        sourceHash: row.source.fingerprint,
        durationMs: row.source.durationMs,
        range,
        source: { kind: "s3", bucket: row.media.bucket, key: row.media.objectKey },
        media: sourceMediaFacts(probe, row.source.durationMs),
      },
      // The derived identity is stronger than a caller-provided retry key:
      // two browser tabs asking for the same immutable clip/source range must
      // converge on one expensive medium job.
      idempotencyKey: `hve5:dense:${row.clip.id}:${row.source.fingerprint}:${range.startMs}:${range.endMs}`,
      artifactHash: createHash("sha256").update(`${analysisId}:scene-graph:v1`).digest("hex"),
      estimatedCost: String(Math.max(1, Math.ceil((range.endMs - range.startMs) / 30_000))),
      queueWeight: String(productPlans[planCode].queueWeight),
    }).onConflictDoUpdate({
      target: [jobs.workspaceId, jobs.idempotencyKey],
      set: { updatedAt: new Date() },
    }).returning();
    await app.db.insert(jobRequirements).values({
      jobId: job.id,
      requirements: {
        engineVersion: "hve-0.1",
        requiredModels: {},
        minimumRamBytes: 512 * 1024 ** 2,
        minimumScratchBytes: 0,
        requiredClasses: ["cpu_medium"],
        requiredJobTypes: ["analyze_clip_visual"],
        workspaceConcurrencyLimit: productPlans[planCode].activeProjects,
      },
    }).onConflictDoNothing();
    return reply.code(202).send({
      analysisId,
      jobId: job.id,
      status: job.status,
      range,
      density: "dense",
    });
  });

  /**
   * Lists only face tracks that can actually cover this clip's retained source
   * interval. It is deliberately a fact summary for the participant picker,
   * not a media endpoint: no raw frames, detector embeddings or S3 locations
   * leave the control API.
   */
  app.get("/v1/projects/:projectId/clips/:clipId/perception", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({
      clip: clips,
      moment: momentCandidates,
      project: projects,
      source: sources,
    }).from(clips)
      .innerJoin(momentCandidates, eq(momentCandidates.id, clips.momentCandidateId))
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .where(and(
        eq(clips.id, clipId),
        eq(clips.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Clip not found");
    if (!row.source.fingerprint || !row.source.durationMs
      || row.moment.startMs < 0 || row.moment.endMs <= row.moment.startMs
      || row.moment.endMs > row.source.durationMs) {
      return { status: "unavailable" as const, reason: "source_or_range_not_ready" as const };
    }
    const range = { startMs: row.moment.startMs, endMs: row.moment.endMs };
    const analysisId = denseClipPerceptionAnalysisId(row.clip.id, row.source.id, row.source.fingerprint, range);
    let context;
    try {
      context = await loadVerifiedHvePerceptionContext({
        db: app.db,
        workspaceId,
        sourceId: row.source.id,
        sourceHash: row.source.fingerprint,
        analysisId,
        probe: (row.source.metadata as { probe?: unknown }).probe,
      });
    } catch (error) {
      request.log.warn({ error, clipId, projectId, analysisId }, "HVE dense perception artifact rejected");
      return { status: "unavailable" as const, reason: "visual_evidence_rejected" as const };
    }
    if (!context) return { status: "pending" as const, analysisId };
    const sourceRange = { startUs: range.startMs * 1_000, endUs: range.endMs * 1_000 };
    const faceEvidence = context.faceEvidence;
    if (!faceEvidence || faceEvidence.density !== "dense" || !faceEvidence.coverage.some((coverage) => (
      coverage.startUs <= sourceRange.startUs && coverage.endUs >= sourceRange.endUs
    ))) {
      return { status: "unavailable" as const, reason: "visual_evidence_partial" as const, analysisId };
    }
    return {
      status: "ready" as const,
      analysisId: context.analysisId,
      density: faceEvidence.density,
      sourceRange,
      faceTracks: faceTracksCoveringSourceRange(context.graph, sourceRange),
    };
  });

  app.get("/v1/projects/:projectId/clips/:clipId/draft", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const { workspaceId, userId } = request.authContext!;

    const draft = await app.db.transaction(async (tx) => {
      const [clip] = await tx.select({
        id: clips.id,
        currentVersion: clips.currentVersion,
        title: clips.title,
        socialTitle: clips.socialTitle,
        socialDescription: clips.socialDescription,
      }).from(clips)
        .innerJoin(projects, eq(projects.id, clips.projectId))
        .where(and(
          eq(clips.id, clipId),
          eq(clips.projectId, projectId),
          eq(projects.workspaceId, workspaceId),
        ))
        .for("update")
        .limit(1);
      if (!clip) throw app.httpErrors.notFound("Clip not found");

      const [existing] = await tx.select().from(clipDrafts)
        .where(and(eq(clipDrafts.clipId, clipId), eq(clipDrafts.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (existing) return existing;

      const [version] = await tx.select({
        documentV2: clipVersions.documentV2,
        editorMetadata: clipVersions.editorMetadata,
      })
        .from(clipVersions)
        .where(and(eq(clipVersions.clipId, clip.id), eq(clipVersions.version, clip.currentVersion)))
        .limit(1);
      if (!version?.documentV2) {
        throw app.httpErrors.conflict("HVE v2 editor document is not available for this clip");
      }

      const document = clipDocumentV2Schema.parse(version.documentV2);
      if (document.clipId !== clip.id) {
        throw app.httpErrors.conflict("HVE v2 document does not match the selected clip");
      }
      const documentHash = await hashHve(document);
      const metadata = clipDraftMetadataSchema.parse(version.editorMetadata ?? {
        title: clip.title,
        socialTitle: clip.socialTitle,
        socialDescription: clip.socialDescription,
      });
      const [created] = await tx.insert(clipDrafts).values({
        workspaceId,
        clipId: clip.id,
        baseVersion: clip.currentVersion,
        revision: 0,
        document,
        documentHash,
        metadata,
        updatedBy: userId,
      }).returning();
      return created;
    });

    return { draft: serializeDraft(draft) };
  });

  app.put("/v1/projects/:projectId/clips/:clipId/draft", { preHandler: app.requireWorkspace }, async (request) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const body = applyEditorCommandBatchSchema.parse(request.body);
    const { workspaceId, userId } = request.authContext!;

    const result = await app.db.transaction(async (tx) => {
      const [clip] = await tx.select({
        id: clips.id,
        currentVersion: clips.currentVersion,
      }).from(clips)
        .innerJoin(projects, eq(projects.id, clips.projectId))
        .where(and(
          eq(clips.id, clipId),
          eq(clips.projectId, projectId),
          eq(projects.workspaceId, workspaceId),
        ))
        .for("update")
        .limit(1);
      if (!clip) throw app.httpErrors.notFound("Clip not found");

      const [draft] = await tx.select().from(clipDrafts)
        .where(and(eq(clipDrafts.clipId, clip.id), eq(clipDrafts.workspaceId, workspaceId)))
        .for("update")
        .limit(1);
      if (!draft) throw app.httpErrors.notFound("Editor draft not found");
      if (draft.baseVersion !== clip.currentVersion) {
        throw app.httpErrors.conflict("Draft is based on an older clip version; reopen the editor");
      }

      const [replayed] = await tx.select().from(editorCommandBatches)
        .where(and(
          eq(editorCommandBatches.clipDraftId, draft.id),
          eq(editorCommandBatches.batchId, body.batchId),
        ))
        .limit(1);
      if (replayed) {
        return { draft, replayed: true, results: replayed.results };
      }

      if (draft.revision !== body.baseRevision) {
        throw app.httpErrors.conflict("Draft was updated in another session");
      }
      const nextDraft = applyEditorDraftCommands({
        document: clipDocumentV2Schema.parse(draft.document),
        metadata: clipDraftMetadataSchema.parse(draft.metadata),
        commands: body.commands,
      });
      const documentHash = await hashHve(nextDraft.document);
      const nextRevision = draft.revision + 1;
      const [updated] = await tx.update(clipDrafts).set({
        revision: nextRevision,
        document: nextDraft.document,
        documentHash,
        metadata: nextDraft.metadata,
        updatedBy: userId,
        updatedAt: new Date(),
      }).where(eq(clipDrafts.id, draft.id)).returning();
      const results = body.commands.map((command) => ({ commandId: command.commandId, status: "applied" }));
      await tx.insert(editorCommandBatches).values({
        clipDraftId: draft.id,
        batchId: body.batchId,
        baseRevision: body.baseRevision,
        resultingRevision: nextRevision,
        commands: body.commands,
        results,
        createdBy: userId,
      });
      return { draft: updated, replayed: false, results };
    });

    return { draft: serializeDraft(result.draft), replayed: result.replayed, results: result.results };
  });

  app.post("/v1/projects/:projectId/clips/:clipId/draft/commit", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { projectId, clipId } = request.params as { projectId: string; clipId: string };
    const body = commitEditorDraftSchema.parse(request.body);
    const key = getIdempotencyKey(request);
    const { workspaceId, userId } = request.authContext!;

    // Fetch an immutable perception artifact before the transactional commit.
    // S3 I/O must not hold row locks. The transaction below still verifies the
    // exact draft revision, source and analysis id before it can use this
    // snapshot, so a concurrent edit becomes a conflict instead of a stale
    // render.
    const [draftPreview] = await app.db.select({
      draft: clipDrafts,
      clip: clips,
      project: projects,
      source: sources,
    }).from(clipDrafts)
      .innerJoin(clips, eq(clips.id, clipDrafts.clipId))
      .innerJoin(projects, eq(projects.id, clips.projectId))
      .innerJoin(sources, eq(sources.id, projects.sourceId))
      .where(and(
        eq(clipDrafts.clipId, clipId),
        eq(clipDrafts.workspaceId, workspaceId),
        eq(clips.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
      ))
      .limit(1);
    // Asset ownership is resolved before we acquire the clip/draft locks. The
    // transactional commit still receives only the immutable hash + private
    // object locator snapshot, so a URL or an arbitrary external object can
    // never be smuggled into an HVE document.
    let staticAssets = new Map<string, RenderAssetInput>();
    if (draftPreview) {
      const previewDocument = clipDocumentV2Schema.parse(draftPreview.draft.document);
      try {
        staticAssets = await loadVerifiedHveRenderAssets({
          db: app.db,
          workspaceId,
          document: previewDocument,
        });
      } catch (error) {
        if (error instanceof Error && ["HVE_ASSET_NOT_AVAILABLE", "HVE_BRAND_ASSET_INVALID"].includes(error.message)) {
          throw app.httpErrors.conflict(error.message);
        }
        throw error;
      }
    }
    let perceptionContext: Awaited<ReturnType<typeof loadVerifiedHvePerceptionContext>> = null;
    if (draftPreview) {
      const previewDocument = clipDocumentV2Schema.parse(draftPreview.draft.document);
      const needsPerception = hveDocumentRequiresPerception(previewDocument);
      if (needsPerception) {
        if (!draftPreview.source.fingerprint) throw app.httpErrors.conflict("HVE5_SOURCE_FINGERPRINT_REQUIRED");
        try {
          perceptionContext = await loadVerifiedHvePerceptionContext({
            db: app.db,
            workspaceId,
            sourceId: draftPreview.source.id,
            sourceHash: draftPreview.source.fingerprint,
            analysisId: previewDocument.analysisId,
            probe: (draftPreview.source.metadata as { probe?: unknown }).probe,
          });
        } catch (error) {
          request.log.warn({ error, clipId, projectId }, "HVE-5 perception artifact rejected");
          throw app.httpErrors.conflict("HVE5_ANALYSIS_ARTIFACT_INVALID");
        }
        if (!perceptionContext) throw app.httpErrors.conflict("HVE5_ANALYSIS_ARTIFACT_REQUIRED");
      }
    }

    const result = await runIdempotent({
      db: app.db,
      workspaceId,
      key,
      body,
      statusCode: 202,
      execute: async (tx) => {
        const [row] = await tx.select({
          clip: clips,
          baseVersion: clipVersions,
          project: projects,
          source: sources,
          media: mediaObjects,
        }).from(clips)
          .innerJoin(projects, eq(projects.id, clips.projectId))
          .innerJoin(sources, eq(sources.id, projects.sourceId))
          .innerJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
          .innerJoin(clipVersions, and(
            eq(clipVersions.clipId, clips.id),
            eq(clipVersions.version, clips.currentVersion),
          ))
          .where(and(
            eq(clips.id, clipId),
            eq(clips.projectId, projectId),
            eq(projects.workspaceId, workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!row) throw app.httpErrors.notFound("Clip cannot be committed");

        const [draft] = await tx.select().from(clipDrafts)
          .where(and(eq(clipDrafts.clipId, row.clip.id), eq(clipDrafts.workspaceId, workspaceId)))
          .for("update")
          .limit(1);
        if (!draft) throw app.httpErrors.notFound("Editor draft not found");
        if (draft.baseVersion !== row.clip.currentVersion || draft.revision !== body.expectedRevision) {
          throw app.httpErrors.conflict("Draft was updated in another session; refresh before rendering");
        }

        const document = clipDocumentV2Schema.parse(draft.document);
        if (document.clipId !== row.clip.id || document.sourceRefs.length !== 1 || document.sourceRefs[0]?.sourceId !== row.source.id) {
          throw app.httpErrors.conflict("HVE document no longer matches this clip source");
        }

        let execution;
        try {
          const transcriptWords = await readTimingTranscriptWords(tx, row.source.id);
          const requiresPerception = hveDocumentRequiresPerception(document);
          // HVE-5 is opt-in at the document level. A requested cropTrack has
          // no static fallback at commit time: it must use the exact verified
          // artifact preloaded above or the user receives a conflict.
          if (requiresPerception && !perceptionContext) {
            throw app.httpErrors.conflict("HVE5_ANALYSIS_ARTIFACT_REQUIRED");
          }
          execution = requiresPerception
            ? await resolveHve5ExecutionPlan(document, transcriptWords, perceptionContext!, hveAssetResolverForPlan(staticAssets))
            : await resolveHve3ExecutionPlan(document, transcriptWords, hveAssetResolverForPlan(staticAssets));
        } catch (error) {
          if (error instanceof Hve5PlanNotExecutableError || error instanceof Hve3PlanNotExecutableError || error instanceof Hve2PlanNotExecutableError || error instanceof HveFontNotExecutableError) {
            throw app.httpErrors.conflict(`${error.code}: ${error.message}`);
          }
          throw error;
        }

        const baseEdl = clipEdlSchema.parse(row.baseVersion.edl);
        // Do not keep the original EDL subtitle values after an HVE edit.
        // The worker currently receives the resolved plan plus this compact
        // envelope, so leaving the envelope stale would make a saved caption
        // style look correct in the editor and render incorrectly in MP4.
        const edl = materializeHveRenderEdl(document, baseEdl);
        const renderHash = await hashHve({
          documentHash: execution.documentHash,
          resolvedPlan: execution.resolvedPlan,
          rendererVersion: document.rendererVersion,
        });
        const nextVersion = row.clip.currentVersion + 1;
        const [version] = await tx.insert(clipVersions).values({
          clipId: row.clip.id,
          version: nextVersion,
          edl,
          documentV2: document,
          documentHash: execution.documentHash,
          editorMetadata: draft.metadata,
          renderHash,
          createdBy: userId,
        }).returning();
        // Rendering is deterministic over the immutable document, resolved
        // plan and renderer version. A no-op editor commit must therefore not
        // spend CPU or make the user wait again. The cache is deliberately
        // checked only after creating the new immutable version so every
        // request still has an auditable version row of its own.
        const cachedCandidates = await tx.select({ artifact: renderArtifacts, version: clipVersions, media: mediaObjects })
          .from(clipVersions)
          .innerJoin(renderArtifacts, eq(renderArtifacts.clipVersionId, clipVersions.id))
          .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
          .where(and(
            eq(clipVersions.renderHash, renderHash),
            eq(mediaObjects.workspaceId, workspaceId),
            eq(renderArtifacts.kind, "mp4"),
          ))
          .limit(12);
        const cached = cachedCandidates.find((candidate) => isAdmissibleRenderCacheCandidate({
          requestedWorkspaceId: workspaceId,
          mediaWorkspaceId: candidate.media.workspaceId,
          mediaDeletedAt: candidate.media.deletedAt,
          mediaExpiresAt: candidate.media.expiresAt,
          validation: candidate.artifact.validation,
        }));

        let job: typeof jobs.$inferSelect | null = null;
        let reusedRender = false;
        if (cached) {
          const retention = await clipArtifactExpiry(tx, workspaceId);
          // MP4 validation admitted the cache entry. Copy every other
          // independently validated retained artifact (SRT/VTT/thumbnail)
          // from the same version so a cache hit never advertises a partial
          // download package.
          const cachedArtifacts = await tx.select({ artifact: renderArtifacts, media: mediaObjects })
            .from(renderArtifacts)
            .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
            .where(eq(renderArtifacts.clipVersionId, cached.version.id));
          for (const cachedArtifact of cachedArtifacts) {
            if (!isAdmissibleRenderCacheCandidate({
              requestedWorkspaceId: workspaceId,
              mediaWorkspaceId: cachedArtifact.media.workspaceId,
              mediaDeletedAt: cachedArtifact.media.deletedAt,
              mediaExpiresAt: cachedArtifact.media.expiresAt,
              validation: cachedArtifact.artifact.validation,
            })) continue;
            if (cachedArtifact.media.expiresAt === null || cachedArtifact.media.expiresAt < retention) {
              await tx.update(mediaObjects).set({ expiresAt: retention, updatedAt: new Date() })
                .where(eq(mediaObjects.id, cachedArtifact.media.id));
            }
            await tx.insert(renderArtifacts).values({
              clipVersionId: version.id,
              mediaObjectId: cachedArtifact.media.id,
              kind: cachedArtifact.artifact.kind,
              validation: cachedArtifact.artifact.validation,
            }).onConflictDoNothing();
          }
          reusedRender = true;
        } else {
          const [queuedJob] = await tx.insert(jobs).values({
            workspaceId,
            projectId,
            clipId: row.clip.id,
            type: "render_clip",
            class: "cpu_heavy",
            payload: {
              clipVersionId: version.id,
              edl,
              source: { kind: "s3", bucket: row.media.bucket, key: row.media.objectKey },
              sourceHasAudio: Boolean((row.source.metadata.probe as { audio?: unknown } | undefined)?.audio),
              subtitleCues: execution.subtitleCues,
              resolvedPlan: execution.resolvedPlan,
              // URLs are deliberately absent: the worker authenticates to S3
              // itself and verifies this immutable hash after downloading.
              renderAssets: renderAssetsForResolvedPlan(execution.resolvedPlan, staticAssets),
            },
            idempotencyKey: `hve-draft:${row.clip.id}:${nextVersion}:${renderHash}`,
            artifactHash: renderHash,
            estimatedCost: String(Math.max(
              Number(baseEdl.range.endMs) - Number(baseEdl.range.startMs),
              1,
            ) / 1000),
          }).returning();
          job = queuedJob ?? null;
        }
        const metadata = clipDraftMetadataSchema.parse(draft.metadata);
        await tx.update(clips).set({
          title: metadata.title,
          socialTitle: metadata.socialTitle,
          socialDescription: metadata.socialDescription,
          currentVersion: nextVersion,
          status: reusedRender ? "ready" : "queued",
          updatedAt: new Date(),
        })
          .where(eq(clips.id, row.clip.id));
        // The command log remains append-only; reset only the mutable cursor
        // so the next edit starts from the version that was actually queued.
        await tx.update(clipDrafts).set({
          baseVersion: nextVersion,
          revision: 0,
          document,
          documentHash: execution.documentHash,
          metadata,
          updatedBy: userId,
          updatedAt: new Date(),
        }).where(eq(clipDrafts.id, draft.id));
        return { version, job, documentHash: execution.documentHash, reusedRender };
      },
    });

    reply.header("Idempotency-Replayed", String(result.replayed));
    return reply.code(result.replayed ? 200 : 202).send({ ...result.value, replayed: result.replayed });
  });
}
