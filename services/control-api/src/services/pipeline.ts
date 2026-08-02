import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import {
  clipVersions,
  clips,
  jobs,
  mediaObjects,
  minuteReservations,
  momentCandidates,
  momentSearches,
  projectVersions,
  projects,
  renderArtifacts,
  sources,
  styleVersions,
  transcripts,
  workspaces,
} from "../../../../db/schema.js";
import { clipEdlSchema, styleConfigSchema } from "../../../../packages/contracts/src/index.js";
import { clampExportForPlan, productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import { commitReservation, reserveMinutes } from "./minutes.js";
import { buildSubtitleCues } from "./subtitles.js";
import { parseSttResponse, writeTranscriptSegments } from "./transcript.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function renderHash(edl: unknown) {
  return createHash("sha256").update(canonicalJson(edl)).digest("hex");
}

async function mediaExpiry(db: Database, workspaceId: string, kind: "source" | "clip") {
  const [workspace] = await db.select({ planCode: workspaces.planCode })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const planCode = (workspace?.planCode && workspace.planCode in productPlans
    ? workspace.planCode
    : "free") as PlanCode;
  const days = kind === "source"
    ? productPlans[planCode].sourceRetentionDays
    : productPlans[planCode].outputRetentionDays;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function projectSource(db: Database, projectId: string) {
  const [row] = await db.select({
    project: projects,
    source: sources,
    media: mediaObjects,
  }).from(projects)
    .innerJoin(sources, eq(sources.id, projects.sourceId))
    .leftJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row;
}

async function enqueue(db: Database, values: typeof jobs.$inferInsert) {
  const [job] = await db.insert(jobs).values(values).onConflictDoNothing().returning();
  return job ?? null;
}

export async function advancePipeline(db: Database, completedJob: typeof jobs.$inferSelect) {
  if (!completedJob.projectId) return;
  const result = completedJob.result ?? {};
  const sourceRow = await projectSource(db, completedJob.projectId);
  if (!sourceRow) return;

  if (completedJob.type === "probe" || completedJob.type === "youtube_import") {
    const durationMs = Number(result.durationMs ?? 0);
    const fingerprint = String(result.fingerprint ?? "");
    if (!durationMs || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error("PROBE_RESULT_INVALID");
    }
    let originalMediaId = sourceRow.source.originalMediaId;
    if (!originalMediaId && result.bucket && result.key) {
      const expiresAt = await mediaExpiry(db, completedJob.workspaceId, "source");
      const [media] = await db.insert(mediaObjects).values({
        workspaceId: completedJob.workspaceId,
        bucket: String(result.bucket),
        objectKey: String(result.key),
        kind: "source",
        mimeType: String(result.mimeType ?? "video/mp4"),
        byteSize: Number(result.byteSize ?? 0),
        sha256: fingerprint,
        expiresAt,
      }).returning();
      originalMediaId = media.id;
    } else if (originalMediaId) {
      await db.update(mediaObjects)
        .set({ expiresAt: await mediaExpiry(db, completedJob.workspaceId, "source") })
        .where(eq(mediaObjects.id, originalMediaId));
    }
    await db.update(sources).set({
      originalMediaId,
      fingerprint,
      durationMs,
      metadata: { ...sourceRow.source.metadata, probe: result },
      updatedAt: new Date(),
    }).where(eq(sources.id, sourceRow.source.id));

    const reservation = await reserveMinutes({
      db,
      workspaceId: completedJob.workspaceId,
      projectId: completedJob.projectId,
      sourceFingerprint: fingerprint,
      seconds: Math.ceil(durationMs / 1000),
      idempotencyKey: `project:${completedJob.projectId}:source:${fingerprint}:reserve`,
    });
    await db.update(projects).set({ status: "transcribing", updatedAt: new Date() })
      .where(eq(projects.id, completedJob.projectId));
    const media = originalMediaId
      ? await db.select().from(mediaObjects).where(eq(mediaObjects.id, originalMediaId)).limit(1)
      : [];
    if (!media[0]) throw new Error("SOURCE_MEDIA_MISSING");
    await enqueue(db, {
      workspaceId: completedJob.workspaceId,
      projectId: completedJob.projectId,
      type: "extract_audio",
      class: "cpu_light",
      payload: {
        sourceId: sourceRow.source.id,
        source: { kind: "s3", bucket: media[0].bucket, key: media[0].objectKey },
        reservationId: reservation.reservationId,
      },
      idempotencyKey: `project:${completedJob.projectId}:extract-audio:v1`,
      estimatedCost: String(durationMs / 1000),
      queueWeight: completedJob.queueWeight,
    });
    return;
  }

  if (completedJob.type === "extract_audio") {
    await enqueue(db, {
      workspaceId: completedJob.workspaceId,
      projectId: completedJob.projectId,
      type: "speech_to_text",
      class: "cpu_heavy",
      payload: {
        audio: result.audio,
        language: "auto",
        reservationId: completedJob.payload.reservationId,
      },
      idempotencyKey: `project:${completedJob.projectId}:stt:v1`,
      estimatedCost: completedJob.estimatedCost,
      queueWeight: completedJob.queueWeight,
    });
    return;
  }

  if (completedJob.type === "speech_to_text") {
    const sttResponse = result.response as Record<string, unknown>;
    const [transcript] = await db.insert(transcripts).values({
      sourceId: sourceRow.source.id,
      provider: String(result.provider ?? "unknown"),
      language: String(sttResponse.language ?? result.language ?? "auto"),
      originalPayload: sttResponse,
    }).onConflictDoUpdate({
      target: transcripts.sourceId,
      set: {
        provider: String(result.provider ?? "unknown"),
        language: String(sttResponse.language ?? result.language ?? "auto"),
        originalPayload: sttResponse,
        updatedAt: new Date(),
      },
    }).returning();
    const parsedSegments = parseSttResponse(sttResponse);
    if (parsedSegments) await writeTranscriptSegments(db, transcript.id, parsedSegments);
    const reservationId = completedJob.payload.reservationId;
    if (typeof reservationId === "string") await commitReservation(db, reservationId);
    await db.update(sources).set({
      analyzedAt: new Date(),
      lastProcessedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(sources.id, sourceRow.source.id));
    const [version] = await db.select().from(projectVersions)
      .where(and(eq(projectVersions.projectId, completedJob.projectId), eq(projectVersions.version, sourceRow.project.currentVersion)))
      .limit(1);
    await db.update(projects).set({ status: "finding_moments", updatedAt: new Date() })
      .where(eq(projects.id, completedJob.projectId));
    await enqueue(db, {
      workspaceId: completedJob.workspaceId,
      projectId: completedJob.projectId,
      type: "find_moments",
      class: "provider",
      payload: {
        transcriptId: transcript.id,
        transcript: result.response,
        settings: version?.settings ?? {},
      },
      idempotencyKey: `project:${completedJob.projectId}:moments:v1`,
      estimatedCost: completedJob.estimatedCost,
      queueWeight: completedJob.queueWeight,
    });
    return;
  }

  if (completedJob.type === "find_moments") {
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const [search] = await db.insert(momentSearches).values({
      jobId: completedJob.id,
      projectId: completedJob.projectId,
      transcriptRevision: 0,
      mode: "best",
      settings: completedJob.payload.settings as Record<string, unknown>,
      status: "succeeded",
    }).onConflictDoUpdate({
      target: momentSearches.jobId,
      set: { status: "succeeded", updatedAt: new Date() },
    }).returning();
    const [candidateCount] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(momentCandidates).where(eq(momentCandidates.searchId, search.id));
    if (candidates.length && Number(candidateCount?.count ?? 0) === 0) {
      await db.insert(momentCandidates).values(candidates.slice(0, 50).map((candidate) => {
        const item = candidate as Record<string, unknown>;
        return {
          searchId: search.id,
          startMs: Number(item.startMs),
          endMs: Number(item.endMs),
          title: String(item.title ?? "Найденный момент"),
          topic: String(item.topic ?? "Момент"),
          explanation: String(item.explanation ?? ""),
          score: item.score == null ? null : String(item.score),
          warnings: Array.isArray(item.warnings) ? item.warnings.map(String) : [],
        };
      }));
    }
    await db.update(projects).set({ status: "review_required", updatedAt: new Date() })
      .where(eq(projects.id, completedJob.projectId));
    return;
  }

  if (completedJob.type === "face_track" && completedJob.clipId) {
    if (!sourceRow.project.styleVersionId) throw new Error("PROJECT_STYLE_MISSING");
    const [clip] = await db.select({
      clip: clips,
      moment: momentCandidates,
      style: styleVersions,
    }).from(clips)
      .innerJoin(momentCandidates, eq(momentCandidates.id, clips.momentCandidateId))
      .innerJoin(styleVersions, eq(styleVersions.id, sourceRow.project.styleVersionId))
      .where(eq(clips.id, completedJob.clipId))
      .limit(1);
    if (!clip || !sourceRow.source.fingerprint || !sourceRow.media) throw new Error("CLIP_RENDER_INPUT_MISSING");
    const [projectVersion] = await db.select({ settings: projectVersions.settings })
      .from(projectVersions)
      .where(and(
        eq(projectVersions.projectId, sourceRow.project.id),
        eq(projectVersions.version, sourceRow.project.currentVersion),
      ))
      .limit(1);
    // The wizard's per-project format pick (`projectOverrides`, e.g. layout)
    // is stored on the project version at creation time but only ever meant
    // for THIS project's clips — applied on top of the style, never
    // persisted back onto the shared style itself.
    const projectOverrides = (projectVersion?.settings as { projectOverrides?: Record<string, unknown> } | undefined)
      ?.projectOverrides ?? {};
    const style = styleConfigSchema.parse({ ...styleConfigSchema.parse(clip.style.config), ...projectOverrides });
    const [renderWorkspace] = await db.select({ planCode: workspaces.planCode })
      .from(workspaces).where(eq(workspaces.id, completedJob.workspaceId)).limit(1);
    const edl = clipEdlSchema.parse({
      schemaVersion: 1,
      sourceId: sourceRow.source.id,
      sourceHash: sourceRow.source.fingerprint,
      range: { startMs: clip.moment.startMs, endMs: clip.moment.endMs },
      cuts: [],
      layout: style.layout,
      cropTrack: result.cropTrack,
      subtitles: style.subtitles,
      silence: style.silence,
      title: style.title,
      logo: style.logo,
      banner: style.banner,
      export: clampExportForPlan(style.export, (renderWorkspace?.planCode as PlanCode) ?? "free"),
      styleVersionId: clip.style.id,
      rendererVersion: "0.1.0",
    });
    const hash = renderHash(edl);
    const [cached] = await db.select({ artifact: renderArtifacts, version: clipVersions })
      .from(clipVersions)
      .innerJoin(renderArtifacts, eq(renderArtifacts.clipVersionId, clipVersions.id))
      .where(eq(clipVersions.renderHash, hash))
      .limit(1);
    if (cached) {
      await db.update(clips).set({ status: "ready", updatedAt: new Date() }).where(eq(clips.id, clip.clip.id));
      return;
    }
    const [version] = await db.insert(clipVersions).values({
      clipId: clip.clip.id,
      version: clip.clip.currentVersion,
      edl,
      renderHash: hash,
      createdBy: sourceRow.project.createdBy,
    }).onConflictDoUpdate({
      target: [clipVersions.clipId, clipVersions.version],
      set: { edl, renderHash: hash },
    }).returning();
    const subtitleCues = await buildSubtitleCues(db, sourceRow.source.id, clip.moment.startMs, clip.moment.endMs);
    await enqueue(db, {
      workspaceId: completedJob.workspaceId,
      projectId: completedJob.projectId,
      clipId: clip.clip.id,
      type: "render_clip",
      class: "cpu_heavy",
      payload: {
        clipVersionId: version.id,
        edl,
        source: { kind: "s3", bucket: sourceRow.media.bucket, key: sourceRow.media.objectKey },
        subtitleCues,
      },
      idempotencyKey: `clip:${clip.clip.id}:render:${hash}`,
      artifactHash: hash,
      estimatedCost: String((clip.moment.endMs - clip.moment.startMs) / 1000),
      queueWeight: completedJob.queueWeight,
    });
    return;
  }

  if (completedJob.type === "render_clip" && completedJob.clipId) {
    const artifact = result.artifact as Record<string, unknown>;
    const expiresAt = await mediaExpiry(db, completedJob.workspaceId, "clip");
    const [media] = await db.insert(mediaObjects).values({
      workspaceId: completedJob.workspaceId,
      bucket: String(artifact.bucket),
      objectKey: String(artifact.key),
      kind: "clip",
      mimeType: String(artifact.mimeType ?? "video/mp4"),
      byteSize: Number(artifact.byteSize ?? 0),
      expiresAt,
    }).returning();
    const clipVersionId = String(completedJob.payload.clipVersionId);
    await db.insert(renderArtifacts).values({
      clipVersionId,
      mediaObjectId: media.id,
      kind: "mp4",
      validation: result.validation as Record<string, unknown>,
    }).onConflictDoNothing();
    await db.update(clips).set({ status: "ready", updatedAt: new Date() }).where(eq(clips.id, completedJob.clipId));

    const projectClips = await db.select({ status: clips.status }).from(clips)
      .where(eq(clips.projectId, completedJob.projectId));
    const terminal = projectClips.every((clip) => ["ready", "failed"].includes(clip.status));
    if (terminal) {
      const anyFailed = projectClips.some((clip) => clip.status === "failed");
      await db.update(projects).set({
        status: anyFailed ? "partially_ready" : "ready",
        updatedAt: new Date(),
      }).where(eq(projects.id, completedJob.projectId));
    }
  }
}

export async function refundProjectReservation(db: Database, projectId: string) {
  const reservations = await db.select().from(minuteReservations)
    .where(and(eq(minuteReservations.projectId, projectId), eq(minuteReservations.status, "active")));
  return reservations;
}
