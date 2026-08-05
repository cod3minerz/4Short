import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../../../db/index.js";
import {
  clipVersions,
  clips,
  analysisArtifacts,
  brandAssets,
  engineReleases,
  jobs,
  jobRequirements,
  mediaObjects,
  minuteReservations,
  momentCandidates,
  momentSearches,
  projectVersions,
  projectPackages,
  projects,
  renderArtifacts,
  sources,
  sourceAnalyses,
  styleVersions,
  transcripts,
  uploads,
  workspaces,
} from "../../../../db/schema.js";
import {
  clipEdlSchema,
  hashHve,
  sourceAnalysisManifestSchema,
  styleConfigSchema,
  type JobRequirements,
} from "../../../../packages/contracts/src/index.js";
import { clampExportForPlan, productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import { commitReservation, reserveMinutes } from "./minutes.js";
import { isAdmissibleRenderCacheCandidate } from "./render-cache.js";
import { buildSubtitleCues } from "./subtitles.js";
import { parseSttResponse, readHveTranscriptSnapshot, writeTranscriptSegments } from "./transcript.js";
import { buildInitialHveDocument } from "./hve/initial-document.js";
import { resolveHve3ExecutionPlan } from "./hve/render-plan.js";
import { getEnv } from "../env.js";

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

/** Stable UUIDs keep pipeline replays idempotent without persisting random IDs. */
function stableUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
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

/**
 * Source posters follow the source retention policy and are written as real
 * media rows. Keeping the descriptor in source metadata avoids a public URL,
 * while the media row makes lifecycle cleanup and storage accounting see it.
 */
async function persistSourceThumbnail(
  db: Database,
  workspaceId: string,
  thumbnail: unknown,
) {
  if (!thumbnail || typeof thumbnail !== "object" || Array.isArray(thumbnail)) return null;
  const artifact = thumbnail as Record<string, unknown>;
  const bucket = typeof artifact.bucket === "string" ? artifact.bucket : null;
  const objectKey = typeof artifact.key === "string" ? artifact.key : null;
  const byteSize = Number(artifact.byteSize);
  if (!bucket || !objectKey || !Number.isSafeInteger(byteSize) || byteSize <= 0) return null;
  const expiresAt = await mediaExpiry(db, workspaceId, "source");
  await db.insert(mediaObjects).values({
    workspaceId,
    bucket,
    objectKey,
    kind: "source_thumbnail",
    mimeType: typeof artifact.mimeType === "string" ? artifact.mimeType : "image/jpeg",
    byteSize,
    sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : null,
    expiresAt,
  }).onConflictDoUpdate({
    target: [mediaObjects.bucket, mediaObjects.objectKey],
    set: { expiresAt, deletedAt: null, updatedAt: new Date() },
  });
  return { bucket, key: objectKey };
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

async function enqueue(
  db: Database,
  values: typeof jobs.$inferInsert & { requirements?: JobRequirements },
) {
  const { requirements, ...jobValues } = values;
  return db.transaction(async (tx) => {
    const [job] = await tx.insert(jobs).values(jobValues).onConflictDoNothing().returning();
    // A requirement is part of the job contract, so it is written in the
    // same transaction as the job. A v2 task must never become runnable by a
    // legacy worker merely because its requirements insert failed separately.
    if (job && requirements) {
      await tx.insert(jobRequirements).values({ jobId: job.id, requirements });
    }
    return job ?? null;
  });
}

function sourceMediaFacts(result: Record<string, unknown>, durationMs: number) {
  const video = result.video && typeof result.video === "object"
    ? result.video as Record<string, unknown>
    : {};
  const rate = String(video.avg_frame_rate ?? video.r_frame_rate ?? "30/1");
  const [numeratorRaw, denominatorRaw] = rate.split("/", 2);
  const numerator = Math.max(1, Number.parseInt(numeratorRaw, 10) || 30);
  const denominator = Math.max(1, Number.parseInt(denominatorRaw, 10) || 1);
  const rotationCandidate = Number(video.rotation ?? 0);
  const rotation = [0, 90, 180, 270].includes(rotationCandidate) ? rotationCandidate : 0;
  return {
    durationUs: durationMs * 1_000,
    width: Math.max(1, Number(video.width ?? 1)),
    height: Math.max(1, Number(video.height ?? 1)),
    frameRate: { numerator, denominator },
    rotationDegrees: rotation as 0 | 90 | 180 | 270,
    hasAudio: Boolean(result.audio),
  };
}

export async function advancePipeline(db: Database, completedJob: typeof jobs.$inferSelect) {
  const result = completedJob.result ?? {};

  // A freshly uploaded file is checked before there is a project. Persisting
  // this worker measurement turns the wizard's displayed cost and range into
  // a server-verified contract, rather than a File API best guess.
  if (completedJob.type === "source_preview" && !completedJob.projectId) {
    const sourceId = typeof completedJob.payload.sourceId === "string" ? completedJob.payload.sourceId : null;
    if (sourceId) {
      const resultSourceId = typeof result.sourceId === "string" ? result.sourceId : null;
      const durationSeconds = Number(result.durationSeconds);
      if (resultSourceId !== sourceId || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
        throw new Error("SOURCE_PREVIEW_RESULT_INVALID");
      }
      const thumbnail = await persistSourceThumbnail(db, completedJob.workspaceId, result.thumbnail);
      await db.update(sources).set({
        durationMs: durationSeconds * 1000,
        metadata: {
          ...(await db.select({ metadata: sources.metadata }).from(sources).where(eq(sources.id, sourceId)).limit(1))[0]?.metadata,
          preflightJobId: completedJob.id,
          preflightDurationSeconds: durationSeconds,
          // A thumbnail is a worker-generated, private object.  The API
          // signs it only when it is shown; a presigned URL is never stored.
          ...(thumbnail
            ? { thumbnail }
            : {}),
        },
        updatedAt: new Date(),
      }).where(and(eq(sources.id, sourceId), eq(sources.workspaceId, completedJob.workspaceId)));
    }
    return;
  }

  // Asset verification has no project by design. A brand video cannot enter
  // a document until this exact worker-verified result has been bound to the
  // immutable S3 object, so it must be handled before the project pipeline
  // exits for project-less jobs.
  if (completedJob.type === "verify_brand_video") {
    const assetId = typeof completedJob.payload.assetId === "string" ? completedJob.payload.assetId : "";
    const mediaObjectId = typeof completedJob.payload.mediaObjectId === "string" ? completedJob.payload.mediaObjectId : "";
    const resultAssetId = typeof result.assetId === "string" ? result.assetId : "";
    const resultMediaObjectId = typeof result.mediaObjectId === "string" ? result.mediaObjectId : "";
    const sha256 = typeof result.sha256 === "string" && /^[a-f0-9]{64}$/i.test(result.sha256)
      ? result.sha256.toLowerCase()
      : null;
    const byteSize = Number(result.byteSize);
    const mimeType = result.mimeType;
    const verification = result.verification && typeof result.verification === "object" && !Array.isArray(result.verification)
      ? result.verification as Record<string, unknown>
      : null;
    if (
      !assetId || !mediaObjectId || assetId !== resultAssetId || mediaObjectId !== resultMediaObjectId
      || !sha256 || !Number.isSafeInteger(byteSize) || byteSize <= 0 || mimeType !== "video/mp4"
      || verification?.profile !== "hve-timed-visual-h264-aac-v1"
      || !Number.isSafeInteger(Number(verification.durationMs)) || Number(verification.durationMs) < 40 || Number(verification.durationMs) > 120_000
      || !Number.isSafeInteger(Number(verification.width)) || Number(verification.width) <= 0
      || !Number.isSafeInteger(Number(verification.height)) || Number(verification.height) <= 0
    ) {
      throw new Error("HVE_TIMED_ASSET_VERIFICATION_RESULT_INVALID");
    }
    const [row] = await db.select({ asset: brandAssets, media: mediaObjects })
      .from(brandAssets)
      .innerJoin(mediaObjects, eq(mediaObjects.id, brandAssets.mediaObjectId))
      .where(and(
        eq(brandAssets.id, assetId),
        eq(brandAssets.workspaceId, completedJob.workspaceId),
        eq(brandAssets.mediaObjectId, mediaObjectId),
      ))
      .limit(1);
    if (!row || !["video", "broll", "outro"].includes(row.asset.kind) || row.media.deletedAt) {
      throw new Error("HVE_TIMED_ASSET_NOT_FOUND");
    }
    await db.transaction(async (tx) => {
      await tx.update(mediaObjects).set({
        sha256,
        mimeType: "video/mp4",
        byteSize,
        expiresAt: null,
        updatedAt: new Date(),
      }).where(eq(mediaObjects.id, row.media.id));
      await tx.update(uploads).set({ status: "completed", updatedAt: new Date() })
        .where(eq(uploads.mediaObjectId, row.media.id));
      await tx.update(brandAssets).set({
        metadata: {
          ...(row.asset.metadata ?? {}),
          uploadStatus: "completed",
          verificationKind: "timed_media",
          verifiedMimeType: "video/mp4",
          sha256,
          timedMedia: verification,
        },
        updatedAt: new Date(),
      }).where(eq(brandAssets.id, row.asset.id));
    });
    return;
  }

  if (!completedJob.projectId) return;

  if (completedJob.type === "zip_project") {
    const packageId = typeof completedJob.payload.packageId === "string" ? completedJob.payload.packageId : "";
    const manifestHash = typeof completedJob.payload.manifestHash === "string" ? completedJob.payload.manifestHash : "";
    const resultPackageId = typeof result.packageId === "string" ? result.packageId : "";
    const resultManifestHash = typeof result.manifestHash === "string" ? result.manifestHash : "";
    const artifact = result.artifact && typeof result.artifact === "object" && !Array.isArray(result.artifact)
      ? result.artifact as Record<string, unknown>
      : null;
    const bucket = artifact && typeof artifact.bucket === "string" ? artifact.bucket : "";
    const objectKey = artifact && typeof artifact.key === "string" ? artifact.key : "";
    const byteSize = artifact ? Number(artifact.byteSize) : Number.NaN;
    const sha256 = artifact && typeof artifact.sha256 === "string" && /^[a-f0-9]{64}$/.test(artifact.sha256)
      ? artifact.sha256
      : null;
    if (
      !packageId || !manifestHash || packageId !== resultPackageId || manifestHash !== resultManifestHash
      || !bucket || !objectKey || !Number.isSafeInteger(byteSize) || byteSize <= 0
    ) {
      throw new Error("PROJECT_PACKAGE_RESULT_INVALID");
    }
    const [projectPackage] = await db.select().from(projectPackages)
      .where(and(
        eq(projectPackages.id, packageId),
        eq(projectPackages.projectId, completedJob.projectId),
        eq(projectPackages.workspaceId, completedJob.workspaceId),
        eq(projectPackages.manifestHash, manifestHash),
        eq(projectPackages.jobId, completedJob.id),
      ))
      .limit(1);
    if (!projectPackage) throw new Error("PROJECT_PACKAGE_NOT_FOUND");
    const [media] = await db.insert(mediaObjects).values({
      workspaceId: completedJob.workspaceId,
      bucket,
      objectKey,
      kind: "project_package",
      mimeType: "application/zip",
      byteSize,
      sha256,
      expiresAt: await mediaExpiry(db, completedJob.workspaceId, "clip"),
    }).onConflictDoUpdate({
      target: [mediaObjects.bucket, mediaObjects.objectKey],
      set: { deletedAt: null, expiresAt: await mediaExpiry(db, completedJob.workspaceId, "clip"), sha256, updatedAt: new Date() },
    }).returning();
    await db.update(projectPackages).set({
      status: "ready",
      mediaObjectId: media.id,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(projectPackages.id, projectPackage.id));
    return;
  }

  const sourceRow = await projectSource(db, completedJob.projectId);
  if (!sourceRow) return;

  if (completedJob.type === "generate_proxy") {
    const sourceId = typeof result.sourceId === "string" ? result.sourceId : "";
    const sourceHash = typeof result.sourceHash === "string" ? result.sourceHash.toLowerCase() : "";
    const artifact = result.artifact && typeof result.artifact === "object" && !Array.isArray(result.artifact)
      ? result.artifact as Record<string, unknown>
      : null;
    const probe = result.probe && typeof result.probe === "object" && !Array.isArray(result.probe)
      ? result.probe as Record<string, unknown>
      : null;
    const bucket = typeof artifact?.bucket === "string" ? artifact.bucket : "";
    const objectKey = typeof artifact?.key === "string" ? artifact.key : "";
    const byteSize = Number(artifact?.byteSize);
    const sha256 = typeof artifact?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(artifact.sha256)
      ? artifact.sha256.toLowerCase()
      : null;
    const video = probe?.video && typeof probe.video === "object" ? probe.video as Record<string, unknown> : null;
    const audio = probe?.audio && typeof probe.audio === "object" ? probe.audio as Record<string, unknown> : null;
    if (
      sourceId !== sourceRow.source.id || !sourceRow.source.fingerprint || sourceHash !== sourceRow.source.fingerprint.toLowerCase()
      || !bucket || !objectKey || !Number.isSafeInteger(byteSize) || byteSize <= 0 || !sha256
      || video?.codec_name !== "h264" || (audio && audio.codec_name !== "aac")
    ) {
      throw new Error("BROWSER_PROXY_RESULT_INVALID");
    }
    const expiry = await mediaExpiry(db, completedJob.workspaceId, "source");
    const [media] = await db.insert(mediaObjects).values({
      workspaceId: completedJob.workspaceId,
      bucket,
      objectKey,
      kind: "browser_proxy",
      mimeType: "video/mp4",
      byteSize,
      sha256,
      expiresAt: expiry,
    }).onConflictDoUpdate({
      target: [mediaObjects.bucket, mediaObjects.objectKey],
      set: { deletedAt: null, expiresAt: expiry, sha256, updatedAt: new Date() },
    }).returning();
    await db.update(sources).set({ proxyMediaId: media.id, updatedAt: new Date() })
      .where(eq(sources.id, sourceRow.source.id));
    return;
  }

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
    const thumbnail = await persistSourceThumbnail(db, completedJob.workspaceId, result.thumbnail);
    await db.update(sources).set({
      originalMediaId,
      fingerprint,
      durationMs,
      metadata: {
        ...sourceRow.source.metadata,
        probe: result,
        ...(thumbnail ? { thumbnail } : {}),
      },
      updatedAt: new Date(),
    }).where(eq(sources.id, sourceRow.source.id));

    const [projectVersion] = await db.select().from(projectVersions)
      .where(and(
        eq(projectVersions.projectId, completedJob.projectId),
        eq(projectVersions.version, sourceRow.project.currentVersion),
      ))
      .limit(1);
    const configuredRange = projectVersion?.settings
      && typeof projectVersion.settings === "object"
      && !Array.isArray(projectVersion.settings)
      && typeof (projectVersion.settings as Record<string, unknown>).momentSettings === "object"
      ? ((projectVersion.settings as Record<string, unknown>).momentSettings as Record<string, unknown>).sourceRange
      : null;
    const rangeStart = configuredRange && typeof configuredRange === "object"
      ? Number((configuredRange as Record<string, unknown>).startSeconds) : 0;
    const rangeEnd = configuredRange && typeof configuredRange === "object"
      ? Number((configuredRange as Record<string, unknown>).endSeconds) : durationMs / 1000;
    const processedSeconds = Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)
      && rangeStart >= 0 && rangeEnd > rangeStart && rangeEnd <= durationMs / 1000
      ? Math.ceil(rangeEnd - rangeStart)
      : Math.ceil(durationMs / 1000);
    const reservation = await reserveMinutes({
      db,
      workspaceId: completedJob.workspaceId,
      projectId: completedJob.projectId,
      sourceFingerprint: fingerprint,
      seconds: processedSeconds,
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
        // Extract only the user-selected range. It is both the exact charged
        // interval and the interval passed to STT; the worker shifts timings
        // back to absolute source time before candidates are generated.
        sourceRange: { startMs: Math.round(rangeStart * 1000), endMs: Math.round(rangeEnd * 1000) },
      },
      idempotencyKey: `project:${completedJob.projectId}:extract-audio:v1`,
      estimatedCost: String(processedSeconds),
      queueWeight: completedJob.queueWeight,
    });
    // A review proxy is a separate convenience artifact.  It must not hold up
    // transcript/moment work, nor should we transcode a source the browser can
    // already play.  The later visual pass will prefer it when it has arrived.
    if (result.browserCompatible !== true) {
      await enqueue(db, {
        workspaceId: completedJob.workspaceId,
        projectId: completedJob.projectId,
        type: "generate_proxy",
        class: "cpu_medium",
        payload: {
          sourceId: sourceRow.source.id,
          sourceHash: fingerprint,
          source: { kind: "s3", bucket: media[0].bucket, key: media[0].objectKey },
        },
        idempotencyKey: `source:${sourceRow.source.id}:hash:${fingerprint}:browser-proxy-720p:v1`,
        availableAt: new Date(Date.now() + 5 * 60 * 1000),
        estimatedCost: String(Math.max(1, Math.ceil(durationMs / 1000 / 30))),
        queueWeight: completedJob.queueWeight,
        requirements: {
          engineVersion: "hve-0.1",
          requiredModels: {},
          minimumRamBytes: 512 * 1024 ** 2,
          minimumScratchBytes: 512 * 1024 ** 2,
          requiredClasses: ["cpu_medium"],
          requiredJobTypes: ["generate_proxy"],
          workspaceConcurrencyLimit: 1,
        },
      });
    }
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
        sourceOffsetMs: Number(completedJob.result?.sourceOffsetMs ?? 0),
      },
      idempotencyKey: `project:${completedJob.projectId}:stt:v1`,
      estimatedCost: completedJob.estimatedCost,
      queueWeight: completedJob.queueWeight,
      requirements: {
        engineVersion: "hve-0.1",
        requiredModels: {},
        minimumRamBytes: 4 * 1024 ** 3,
        minimumScratchBytes: 512 * 1024 ** 2,
        requiredClasses: ["cpu_heavy"],
        requiredJobTypes: ["speech_to_text"],
        workspaceConcurrencyLimit: 1,
      },
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
    // It is useful only once there are candidate clips. Delaying this task
    // until review is ready guarantees a single serial worker cannot make
    // source perception hold up transcription or moment finding.
    if (sourceRow.media && sourceRow.source.fingerprint && sourceRow.source.durationMs) {
      const probe = sourceRow.source.metadata.probe;
      if (probe && typeof probe === "object" && !Array.isArray(probe)) {
        const [proxy] = sourceRow.source.proxyMediaId
          ? await db.select().from(mediaObjects).where(and(
              eq(mediaObjects.id, sourceRow.source.proxyMediaId),
              eq(mediaObjects.workspaceId, completedJob.workspaceId),
            )).limit(1)
          : [];
        // A proxy is only an optional optimization for visual perception. Never
        // hand a worker a retained database row whose object lifecycle has
        // already expired: falling back to the immutable source is safer than a
        // late signed-URL failure after the project has otherwise completed.
        const proxyIsUsable = Boolean(
          proxy &&
          !proxy.deletedAt &&
          (!proxy.expiresAt || proxy.expiresAt > new Date()),
        );
        const perceptionMedia = proxyIsUsable ? proxy! : sourceRow.media;
        await enqueue(db, {
          workspaceId: completedJob.workspaceId,
          projectId: completedJob.projectId,
          type: "analyze_visual",
          class: "cpu_medium",
          payload: {
            analysisId: randomUUID(),
            sourceId: sourceRow.source.id,
            sourceHash: sourceRow.source.fingerprint,
            durationMs: sourceRow.source.durationMs,
            source: { kind: "s3", bucket: perceptionMedia.bucket, key: perceptionMedia.objectKey },
            media: sourceMediaFacts(probe as Record<string, unknown>, sourceRow.source.durationMs),
          },
          idempotencyKey: `source:${sourceRow.source.id}:hash:${sourceRow.source.fingerprint}:visual-analysis:v1`,
          // Defer it slightly: moment review and an immediate user render
          // retain the only worker slot on the initial deployment.
          availableAt: new Date(Date.now() + 5 * 60 * 1000),
          estimatedCost: String(Math.max(1, Math.ceil(sourceRow.source.durationMs / 1000 / 120))),
          queueWeight: completedJob.queueWeight,
          requirements: {
            engineVersion: "hve-0.1",
            requiredModels: {},
            minimumRamBytes: 512 * 1024 ** 2,
            minimumScratchBytes: 0,
            requiredClasses: ["cpu_medium"],
            requiredJobTypes: ["analyze_visual"],
            workspaceConcurrencyLimit: 1,
          },
        });
      }
    }
    return;
  }

  if (completedJob.type === "analyze_visual" || completedJob.type === "analyze_clip_visual") {
    const artifact = result.artifact && typeof result.artifact === "object"
      ? result.artifact as Record<string, unknown>
      : null;
    const sourceId = String(result.sourceId ?? "");
    const sourceHash = String(result.sourceHash ?? "");
    const analysisId = String(result.analysisId ?? "");
    const media = result.media && typeof result.media === "object"
      ? result.media as Record<string, unknown>
      : null;
    const engineRelease = result.engineRelease && typeof result.engineRelease === "object"
      ? result.engineRelease as Record<string, unknown>
      : null;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const density = result.density === "dense" ? "dense" : result.density === "sparse" ? "sparse" : null;
    const engineVersion = typeof engineRelease?.engineVersion === "string" ? engineRelease.engineVersion : "";
    const plannerVersion = typeof engineRelease?.plannerVersion === "string" ? engineRelease.plannerVersion : "";
    const rendererVersion = typeof engineRelease?.rendererVersion === "string" ? engineRelease.rendererVersion : "";
    if (!artifact || sourceId !== sourceRow.source.id || sourceHash !== sourceRow.source.fingerprint || !analysisId || !media
      || !engineVersion || !plannerVersion || !rendererVersion || !density) {
      throw new Error("VISUAL_ANALYSIS_RESULT_INVALID");
    }
    const artifactId = stableUuid(`${analysisId}:scene-graph:v1`);
    const artifactRef = {
      artifactId,
      kind: "scene_graph",
      schemaVersion: 1,
      engineVersion,
      modelVersion: density === "dense" ? "opencv-yunet-dense-clip-v1" : "opencv-yunet-sparse-source-v1",
      objectKey: String(artifact.key ?? ""),
      sha256: String(artifact.sha256 ?? ""),
      byteSize: Number(artifact.byteSize ?? 0),
    };
    const manifest = sourceAnalysisManifestSchema.parse({
      schemaVersion: 1,
      analysisId,
      sourceId,
      sourceHash,
      media,
      artifacts: { scenes: artifactRef, faces: [{ artifact: artifactRef, coverage: result.coverage ?? [], density }] },
      warnings,
      completedAt: new Date().toISOString(),
    });
    // Keep source-evidence identity on the same canonical contract used by
    // the planner.  The HVE loader verifies this value before a dense face
    // track can affect a render, so a second ad-hoc JSON canonicalizer here
    // would create a silent supply-chain split.
    const manifestHash = await hashHve(manifest);
    const expiresAt = sourceRow.media?.expiresAt ?? await mediaExpiry(db, completedJob.workspaceId, "source");
    await db.transaction(async (tx) => {
      const [registeredRelease] = await tx.select({ id: engineReleases.id })
        .from(engineReleases)
        .where(and(
          eq(engineReleases.engineVersion, engineVersion),
          eq(engineReleases.plannerVersion, plannerVersion),
          eq(engineReleases.rendererVersion, rendererVersion),
          eq(engineReleases.status, "active"),
        ))
        .limit(1);
      // A result without a registered release cannot be used later for a
      // reproducible director/render decision.  Fail rather than attach it
      // to whichever release happens to be current.
      if (!registeredRelease) throw new Error("VISUAL_ANALYSIS_ENGINE_RELEASE_UNREGISTERED");
      const [storedMedia] = await tx.insert(mediaObjects).values({
        workspaceId: completedJob.workspaceId,
        bucket: String(artifact.bucket ?? ""),
        objectKey: artifactRef.objectKey,
        kind: "analysis",
        mimeType: String(artifact.mimeType ?? "application/json"),
        byteSize: artifactRef.byteSize,
        sha256: artifactRef.sha256,
        expiresAt,
      }).onConflictDoUpdate({
        target: [mediaObjects.bucket, mediaObjects.objectKey],
        set: { expiresAt, sha256: artifactRef.sha256, byteSize: artifactRef.byteSize, updatedAt: new Date() },
      }).returning();
      const [analysis] = await tx.insert(sourceAnalyses).values({
        id: analysisId,
        workspaceId: completedJob.workspaceId,
        sourceId,
        engineReleaseId: registeredRelease.id,
        sourceHash,
        status: "succeeded",
        manifest,
        manifestHash,
        completedAt: new Date(),
      }).onConflictDoUpdate({
        target: sourceAnalyses.id,
        set: { status: "succeeded", manifest, manifestHash, completedAt: new Date(), updatedAt: new Date() },
      }).returning();
      await tx.insert(analysisArtifacts).values({
        id: artifactId,
        analysisId: analysis.id,
        mediaObjectId: storedMedia.id,
        kind: artifactRef.kind,
        schemaVersion: artifactRef.schemaVersion,
        engineVersion: artifactRef.engineVersion,
        modelVersion: artifactRef.modelVersion,
        objectKey: artifactRef.objectKey,
        sha256: artifactRef.sha256,
        byteSize: artifactRef.byteSize,
        coverage: result.coverage as Array<Record<string, unknown>> ?? [],
        density,
      }).onConflictDoNothing();
    });
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
    const [renderTranscript] = await db.select({ currentRevision: transcripts.currentRevision })
      .from(transcripts).where(eq(transcripts.sourceId, sourceRow.source.id)).limit(1);
    // Snapshot the revision once. Initial HVE documents must own their
    // caption edits; a user changing the project transcript while this job is
    // queued cannot alter an immutable clip version's render later.
    const transcriptSnapshot = await readHveTranscriptSnapshot(
      db,
      sourceRow.source.id,
      renderTranscript?.currentRevision,
    );
    const edl = clipEdlSchema.parse({
      schemaVersion: 1,
      sourceId: sourceRow.source.id,
      sourceHash: sourceRow.source.fingerprint,
      range: { startMs: clip.moment.startMs, endMs: clip.moment.endMs },
      cuts: [],
      transcriptRevision: transcriptSnapshot.revision,
      layout: style.layout,
      cropTrack: result.cropTrack,
      faceTracks: result.faceTracks,
      subtitles: style.subtitles,
      silence: style.silence,
      title: style.title
        ? { ...style.title, text: style.title.text?.trim() || clip.moment.title }
        : undefined,
      logo: style.logo,
      banner: style.banner,
      export: clampExportForPlan(style.export, (renderWorkspace?.planCode as PlanCode) ?? "free"),
      styleVersionId: clip.style.id,
      rendererVersion: "0.1.0",
    });
    // The first clip version enters HVE only when every requested property is
    // executable by the source-slot compositor. Unsupported layouts/assets
    // deliberately retain their readable v1 path; they must never become a
    // fake HVE document that later falls back during rendering.
    const transcriptWords = transcriptSnapshot.words;
    // A v2 version must be edited through the typed draft route. The existing
    // v1 editor serializes a legacy EDL, so shipping a v2 document before its
    // client migration would make a subsequent ordinary save lossy. This is a
    // rollout gate, not a renderer fallback: when disabled, the project stays
    // on the proven v1 execution path unchanged.
    const initialHve = getEnv().HVE_INITIAL_DOCUMENTS_ENABLED
      ? buildInitialHveDocument({
          clipId: clip.clip.id,
          edl,
          transcriptWords,
          captionOverrides: transcriptSnapshot.captionOverrides,
          plannerVersion: "hve-3-initial-document-v1",
          rendererVersion: "hve-3-compositor-v1",
        })
      : { supported: false as const, reason: "HVE_INITIAL_DOCUMENT_ROLLOUT_DISABLED" };
    const hveDocument = initialHve.supported ? initialHve.document : null;
    const hveExecution = hveDocument
      ? await resolveHve3ExecutionPlan(hveDocument, transcriptWords)
      : null;
    const hash = hveExecution
      ? await hashHve({
          documentHash: hveExecution.documentHash,
          resolvedPlan: hveExecution.resolvedPlan,
          rendererVersion: hveDocument!.rendererVersion,
        })
      : renderHash(edl);
    // A render hash alone is never cache evidence. Reuse is restricted to the
    // same workspace, requires a non-deleted retained media object and the
    // exact validation report produced before upload. Older/incomplete cache
    // rows deliberately miss this admission and are rendered again.
    const cachedCandidates = await db.select({ artifact: renderArtifacts, version: clipVersions, media: mediaObjects })
      .from(clipVersions)
      .innerJoin(renderArtifacts, eq(renderArtifacts.clipVersionId, clipVersions.id))
      .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
      .where(and(
        eq(clipVersions.renderHash, hash),
        eq(mediaObjects.workspaceId, completedJob.workspaceId),
        // A caption sidecar is never cache proof on its own. A completed MP4
        // validation is the admission evidence for a reusable render.
        eq(renderArtifacts.kind, "mp4"),
      ))
      .limit(12);
    const cached = cachedCandidates.find((candidate) => isAdmissibleRenderCacheCandidate({
      requestedWorkspaceId: completedJob.workspaceId,
      mediaWorkspaceId: candidate.media.workspaceId,
      mediaDeletedAt: candidate.media.deletedAt,
      mediaExpiresAt: candidate.media.expiresAt,
      validation: candidate.artifact.validation,
    }));
    if (cached) {
      const [version] = await db.insert(clipVersions).values({
        clipId: clip.clip.id,
        version: clip.clip.currentVersion,
        edl,
        ...(hveExecution ? {
          documentV2: hveDocument!,
          documentHash: hveExecution.documentHash,
          editorMetadata: {
            title: clip.clip.title,
            socialTitle: clip.clip.socialTitle,
            socialDescription: clip.clip.socialDescription,
          },
        } : {}),
        renderHash: hash,
        createdBy: sourceRow.project.createdBy,
      }).onConflictDoUpdate({
        target: [clipVersions.clipId, clipVersions.version],
        set: {
          edl,
          ...(hveExecution ? {
            documentV2: hveDocument!,
            documentHash: hveExecution.documentHash,
            editorMetadata: {
              title: clip.clip.title,
              socialTitle: clip.clip.socialTitle,
              socialDescription: clip.clip.socialDescription,
            },
          } : {}),
          renderHash: hash,
        },
      }).returning();
      const retention = await mediaExpiry(db, completedJob.workspaceId, "clip");
      // Reuse the complete retained artifact set belonging to the verified
      // cache version. This preserves downloadable SRT/VTT with a cached MP4
      // and never makes a partial cache look like a complete package.
      const cachedArtifacts = await db.select({ artifact: renderArtifacts, media: mediaObjects })
        .from(renderArtifacts)
        .innerJoin(mediaObjects, eq(mediaObjects.id, renderArtifacts.mediaObjectId))
        .where(eq(renderArtifacts.clipVersionId, cached.version.id));
      for (const cachedArtifact of cachedArtifacts) {
        if (!isAdmissibleRenderCacheCandidate({
          requestedWorkspaceId: completedJob.workspaceId,
          mediaWorkspaceId: cachedArtifact.media.workspaceId,
          mediaDeletedAt: cachedArtifact.media.deletedAt,
          mediaExpiresAt: cachedArtifact.media.expiresAt,
          validation: cachedArtifact.artifact.validation,
        })) continue;
        if (cachedArtifact.media.expiresAt === null || cachedArtifact.media.expiresAt < retention) {
          await db.update(mediaObjects).set({ expiresAt: retention, updatedAt: new Date() })
            .where(eq(mediaObjects.id, cachedArtifact.media.id));
        }
        await db.insert(renderArtifacts).values({
          clipVersionId: version.id,
          mediaObjectId: cachedArtifact.media.id,
          kind: cachedArtifact.artifact.kind,
          validation: cachedArtifact.artifact.validation,
        }).onConflictDoNothing();
      }
      await db.update(clips).set({ status: "ready", updatedAt: new Date() }).where(eq(clips.id, clip.clip.id));
      return;
    }
    const [version] = await db.insert(clipVersions).values({
      clipId: clip.clip.id,
      version: clip.clip.currentVersion,
      edl,
      ...(hveExecution ? {
        documentV2: hveDocument!,
        documentHash: hveExecution.documentHash,
        editorMetadata: {
          title: clip.clip.title,
          socialTitle: clip.clip.socialTitle,
          socialDescription: clip.clip.socialDescription,
        },
      } : {}),
      renderHash: hash,
      createdBy: sourceRow.project.createdBy,
    }).onConflictDoUpdate({
      target: [clipVersions.clipId, clipVersions.version],
      set: {
        edl,
        ...(hveExecution ? {
          documentV2: hveDocument!,
          documentHash: hveExecution.documentHash,
          editorMetadata: {
            title: clip.clip.title,
            socialTitle: clip.clip.socialTitle,
            socialDescription: clip.clip.socialDescription,
          },
        } : {}),
        renderHash: hash,
      },
    }).returning();
    const subtitleCues = hveExecution?.subtitleCues ?? await buildSubtitleCues(
      db,
      sourceRow.source.id,
      clip.moment.startMs,
      clip.moment.endMs,
      edl.transcriptRevision,
    );
    const probe = sourceRow.source.metadata.probe;
    const sourceHasAudio = typeof probe === "object" && probe !== null && !Array.isArray(probe)
      && "audio" in probe && Boolean(probe.audio);
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
        sourceHasAudio,
        subtitleCues,
        ...(hveExecution ? { resolvedPlan: hveExecution.resolvedPlan } : {}),
      },
      idempotencyKey: `clip:${clip.clip.id}:render:${hash}`,
      artifactHash: hash,
      estimatedCost: String((clip.moment.endMs - clip.moment.startMs) / 1000),
      queueWeight: completedJob.queueWeight,
    });
    return;
  }

  if (completedJob.type === "render_clip" && completedJob.clipId) {
    const expiresAt = await mediaExpiry(db, completedJob.workspaceId, "clip");
    const clipVersionId = String(completedJob.payload.clipVersionId);
    const artifact = result.artifact as Record<string, unknown>;
    const captionArtifacts = result.captionArtifacts && typeof result.captionArtifacts === "object"
      ? result.captionArtifacts as Record<string, unknown>
      : {};
    const outputArtifacts: Array<{ kind: "mp4" | "srt" | "vtt"; artifact: Record<string, unknown>; mimeType: string }> = [
      { kind: "mp4", artifact, mimeType: "video/mp4" },
      ...(["srt", "vtt"] as const).flatMap((kind) => {
        const candidate = captionArtifacts[kind];
        return candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? [{ kind, artifact: candidate as Record<string, unknown>, mimeType: kind === "srt" ? "application/x-subrip" : "text/vtt; charset=utf-8" }]
          : [];
      }),
    ];
    for (const outputArtifact of outputArtifacts) {
      const bucket = typeof outputArtifact.artifact.bucket === "string" ? outputArtifact.artifact.bucket : "";
      const objectKey = typeof outputArtifact.artifact.key === "string" ? outputArtifact.artifact.key : "";
      const byteSize = Number(outputArtifact.artifact.byteSize);
      const sha256 = typeof outputArtifact.artifact.sha256 === "string" && /^[a-f0-9]{64}$/.test(outputArtifact.artifact.sha256)
        ? outputArtifact.artifact.sha256
        : null;
      if (!bucket || !objectKey || !Number.isSafeInteger(byteSize) || byteSize < 0) {
        // A worker result is an untrusted process boundary. The MP4 missing is
        // fatal because there is no clip; an optional sidecar is simply not
        // published until a rerender produces a valid result.
        if (outputArtifact.kind === "mp4") throw new Error("RENDER_ARTIFACT_INVALID");
        continue;
      }
      const [media] = await db.insert(mediaObjects).values({
        workspaceId: completedJob.workspaceId,
        bucket,
        objectKey,
        kind: outputArtifact.kind === "mp4" ? "clip" : "caption",
        mimeType: outputArtifact.mimeType,
        byteSize,
        sha256,
        expiresAt,
      }).onConflictDoUpdate({
        target: [mediaObjects.bucket, mediaObjects.objectKey],
        set: { expiresAt, deletedAt: null, sha256, updatedAt: new Date() },
      }).returning();
      await db.insert(renderArtifacts).values({
        clipVersionId,
        mediaObjectId: media.id,
        kind: outputArtifact.kind,
        validation: outputArtifact.kind === "mp4"
          ? result.validation as Record<string, unknown>
          : { valid: true, source: "resolved_caption_plan_v1" },
      }).onConflictDoNothing();
    }
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

/**
 * A terminal timed-brand-media verification failure must not leave an asset
 * looking usable in the editor. The object remains private and retains its
 * short upload expiry for lifecycle cleanup; planners require SHA + completed
 * metadata and therefore fail closed even if this compensating update is
 * delayed.
 */
export async function markBrandAssetVerificationFailed(
  db: Database,
  failedJob: typeof jobs.$inferSelect,
  error: Record<string, unknown>,
) {
  if (failedJob.type !== "verify_brand_video" || failedJob.status !== "failed") return;
  const assetId = typeof failedJob.payload.assetId === "string" ? failedJob.payload.assetId : "";
  const mediaObjectId = typeof failedJob.payload.mediaObjectId === "string" ? failedJob.payload.mediaObjectId : "";
  if (!assetId || !mediaObjectId) return;
  const [row] = await db.select({ asset: brandAssets, media: mediaObjects })
    .from(brandAssets)
    .innerJoin(mediaObjects, eq(mediaObjects.id, brandAssets.mediaObjectId))
    .where(and(
      eq(brandAssets.id, assetId),
      eq(brandAssets.workspaceId, failedJob.workspaceId),
      eq(brandAssets.mediaObjectId, mediaObjectId),
    ))
    .limit(1);
  if (!row || !["video", "broll", "outro"].includes(row.asset.kind)) return;
  await db.transaction(async (tx) => {
    await tx.update(uploads).set({ status: "failed", updatedAt: new Date() })
      .where(eq(uploads.mediaObjectId, row.media.id));
    await tx.update(brandAssets).set({
      metadata: {
        ...(row.asset.metadata ?? {}),
        uploadStatus: "failed",
        verificationKind: "timed_media",
        verificationError: {
          code: typeof error.code === "string" ? error.code : "HVE_TIMED_ASSET_INVALID",
          message: typeof error.message === "string" ? error.message.slice(0, 500) : "Timed media verification failed",
        },
      },
      updatedAt: new Date(),
    }).where(eq(brandAssets.id, row.asset.id));
  });
}

export async function refundProjectReservation(db: Database, projectId: string) {
  const reservations = await db.select().from(minuteReservations)
    .where(and(eq(minuteReservations.projectId, projectId), eq(minuteReservations.status, "active")));
  return reservations;
}
