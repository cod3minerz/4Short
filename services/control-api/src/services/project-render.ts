import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import { clipVersions, clips, jobs, mediaObjects, momentCandidates, momentSearches, projects, projectVersions, sources, stylePresets, styleVersions, transcripts, workspaces } from "../../../../db/schema.js";
import { resolveHveFontPlan, styleConfigSchema } from "../../../../packages/contracts/src/index.js";
import { clampExportForPlan, productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";

type ProjectRenderStatusExecutor = Pick<Database, "select" | "update">;

async function syncProjectRenderStatus(tx: ProjectRenderStatusExecutor, projectId: string) {
  const projectClips = await tx.select({ status: clips.status }).from(clips)
    .where(eq(clips.projectId, projectId));
  if (!projectClips.length || !projectClips.every((clip) => ["ready", "failed"].includes(clip.status))) return;

  const anyReady = projectClips.some((clip) => clip.status === "ready");
  const anyFailed = projectClips.some((clip) => clip.status === "failed");
  await tx.update(projects).set({
    status: anyReady ? (anyFailed ? "partially_ready" : "ready") : "failed",
    errorCode: anyReady ? null : "ALL_CLIPS_FAILED",
    errorMessage: anyReady ? null : "Не удалось обработать ни один клип проекта.",
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));
}

/** Serialize terminal clip projections per project to avoid a completion/failure
 * race where each transaction observes the other's clip as still queued. */
export async function updateProjectRenderStatus(db: Database, projectId: string) {
  await db.transaction(async (tx) => {
    const [project] = await tx.select({ archivedAt: projects.archivedAt }).from(projects)
      .where(eq(projects.id, projectId))
      .for("update")
      .limit(1);
    if (!project || project.archivedAt) return;
    await syncProjectRenderStatus(tx, projectId);
  });
}

export function initialClipIdentity(projectId: string, candidateId: string) {
  const hash = createHash("sha256").update(`initial-clip:${projectId}:${candidateId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Project a terminal render failure only onto the clip version that still
 * owns the clip. A late failure from an older rerender must not overwrite a
 * newer version or its project status. */
export async function markFailedClipRender(db: Database, failedJob: typeof jobs.$inferSelect) {
  if (failedJob.type !== "render_clip" || failedJob.status !== "failed" || !failedJob.projectId || !failedJob.clipId) return;
  const clipVersionId = typeof failedJob.payload.clipVersionId === "string" ? failedJob.payload.clipVersionId : null;
  if (!clipVersionId) return;

  await db.transaction(async (tx) => {
    const [project] = await tx.select({ archivedAt: projects.archivedAt }).from(projects)
      .where(eq(projects.id, failedJob.projectId!))
      .for("update")
      .limit(1);
    if (!project || project.archivedAt) return;

    const [current] = await tx.select({ clip: clips })
      .from(clips)
      .innerJoin(clipVersions, and(
        eq(clipVersions.clipId, clips.id),
        eq(clipVersions.id, clipVersionId),
        eq(clipVersions.version, clips.currentVersion),
      ))
      .where(and(eq(clips.id, failedJob.clipId!), eq(clips.projectId, failedJob.projectId!)))
      .limit(1);
    if (!current) return;

    await tx.update(clips).set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(clips.id, current.clip.id), eq(clips.currentVersion, current.clip.currentVersion)));
    await syncProjectRenderStatus(tx, failedJob.projectId!);
  });
}

/** Shared by auto completion and legacy review. The project lock serializes
 * cancellation and retry; one candidate owns one initial clip/job forever.
 * Render input is frozen here, not re-read from mutable project settings. */
export async function scheduleProjectRenders(db: Database, input: {
  workspaceId: string; projectId: string; momentIds: string[]; projectVersionId?: string; requestedBy?: string;
}) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, input.workspaceId))).for("update").limit(1);
    if (!project || project.archivedAt) throw new Error("PROJECT_NOT_AVAILABLE");
    if (!project.sourceId || !project.styleVersionId) throw new Error("PROJECT_INPUT_NOT_READY");
    const [version] = await tx.select().from(projectVersions).where(and(eq(projectVersions.projectId, project.id), input.projectVersionId ? eq(projectVersions.id, input.projectVersionId) : eq(projectVersions.version, project.currentVersion))).limit(1);
    const [source] = await tx.select({ source: sources, media: mediaObjects }).from(sources).innerJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId)).where(and(eq(sources.id, project.sourceId), eq(sources.workspaceId, input.workspaceId), eq(mediaObjects.workspaceId, input.workspaceId))).limit(1);
    const [styleOwnership] = await tx.select({ version: styleVersions }).from(styleVersions).innerJoin(stylePresets, eq(stylePresets.id, styleVersions.stylePresetId)).where(and(eq(styleVersions.id, project.styleVersionId), eq(stylePresets.workspaceId, input.workspaceId))).limit(1);
    const styleRow = styleOwnership?.version;
    if (!version || !source || !styleRow || source.media.deletedAt || (source.media.expiresAt && source.media.expiresAt <= new Date())) throw new Error("PROJECT_INPUT_NOT_AVAILABLE");
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    const plan = workspace?.planCode && workspace.planCode in productPlans ? workspace.planCode as PlanCode : "free";
    const overrides = version.settings.projectOverrides ?? {};
    const style = styleConfigSchema.parse({ ...styleConfigSchema.parse(styleRow.config), ...overrides as object });
    style.export = clampExportForPlan(style.export, plan);
    // Even while initial ClipDocumentV2 rollout is disabled, the v1 renderer
    // consumes the same immutable worker font pack as HVE. Freeze that plan at
    // scheduling time so the legacy-compatible route remains executable and
    // cache identity changes when the pack changes.
    const fontPlan = resolveHveFontPlan(style.subtitles);
    const ids = [...new Set(input.momentIds)];
    if (!ids.length || ids.length > 50) throw new Error("INVALID_MOMENTS");
    const candidates = await tx.select({ candidate: momentCandidates }).from(momentCandidates).innerJoin(momentSearches, eq(momentSearches.id, momentCandidates.searchId)).where(and(inArray(momentCandidates.id, ids), eq(momentSearches.projectId, project.id)));
    if (candidates.length !== ids.length) throw new Error("UNKNOWN_MOMENT");
    const [transcript] = await tx.select().from(transcripts).where(eq(transcripts.sourceId, source.source.id)).limit(1);
    const output = [];
    let added = false;
    for (const { candidate } of candidates) {
      const [existing] = await tx.select().from(clips).where(and(eq(clips.projectId, project.id), eq(clips.momentCandidateId, candidate.id))).limit(1);
      if (existing) {
        const [job] = await tx.select().from(jobs).where(and(eq(jobs.clipId, existing.id), eq(jobs.type, "face_track"))).limit(1);
        output.push({ clip: existing, job: job ?? null });
        continue;
      }
      const id = initialClipIdentity(project.id, candidate.id);
      const [clip] = await tx.insert(clips).values({ id, projectId: project.id, momentCandidateId: candidate.id, title: candidate.title, status: "queued" }).returning();
      const [job] = await tx.insert(jobs).values({
        workspaceId: input.workspaceId, projectId: project.id, clipId: id,
        type: "face_track", class: "cpu_light",
        payload: {
          clipId: id, momentId: candidate.id, projectVersionId: version.id,
          styleVersionId: styleRow.id, renderStyle: style,
          fontPlan,
          transcriptRevision: transcript?.currentRevision ?? 0,
          requestedBy: input.requestedBy ?? project.createdBy,
          source: { kind: "s3", bucket: source.media.bucket, key: source.media.objectKey },
          range: { startMs: candidate.startMs, endMs: candidate.endMs },
          export: style.export, layout: style.layout,
        },
        idempotencyKey: `initial-clip:${id}:face-track`,
        estimatedCost: String(Math.max((candidate.endMs - candidate.startMs) / 1000, 1)),
        queueWeight: String(productPlans[plan].queueWeight),
      }).returning();
      added = true;
      output.push({ clip, job });
    }
    if (added) await tx.update(projects).set({
      status: "rendering",
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));
    return output;
  });
}
