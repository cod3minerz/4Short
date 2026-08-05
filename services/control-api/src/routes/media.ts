import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { jobs, mediaObjects, sources, uploads, workspaces } from "../../../../db/schema.js";
import { youtubeUrlSchema } from "../../../../packages/contracts/src/index.js";
import { productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import { getEnv } from "../env.js";
import { signDownload } from "../lib/s3.js";

const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i;

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1) || null;
    if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
    const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/);
    return shortsMatch ? shortsMatch[1] : null;
  } catch {
    return null;
  }
}

function parseIso8601Duration(iso: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return (Number(hours ?? 0) * 3600) + (Number(minutes ?? 0) * 60) + Number(seconds ?? 0);
}

type PreviewResult = Record<string, unknown>;

function isPrivateThumbnail(value: unknown): value is { bucket: string; key: string } {
  return Boolean(value && typeof value === "object"
    && typeof (value as Record<string, unknown>).bucket === "string"
    && typeof (value as Record<string, unknown>).key === "string");
}

async function presentPreviewResult(result: PreviewResult | null) {
  if (!result) return null;
  const output = { ...result };
  if (!output.thumbnailUrl && isPrivateThumbnail(output.thumbnail)) {
    output.thumbnailUrl = await signDownload(output.thumbnail.bucket, output.thumbnail.key, 15 * 60);
  }
  return output;
}

/**
 * Cheap, non-AI video metadata for Step 1 of the project wizard — so the
 * user sees the real thumbnail/title of what they pasted (confirmation
 * that we grabbed the right video) before committing anything. Duration
 * (needed for the client-side arithmetic clip-count estimate) requires
 * the YouTube Data API and is only returned when YOUTUBE_API_KEY is
 * configured — oEmbed alone doesn't expose it. Never falls back to a
 * fake number; omits the field instead.
 */
export async function mediaRoutes(app: FastifyInstance) {
  app.post("/v1/media/source-previews", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = request.body as { url?: unknown; sourceId?: unknown };
    const { workspaceId } = request.authContext!;
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : null;
    const remoteUrl = sourceId ? null : youtubeUrlSchema.parse(body.url);
    const normalizedUrl = remoteUrl ? new URL(remoteUrl).toString() : null;
    const preflightKey = createHash("sha256").update(normalizedUrl ?? sourceId ?? "").digest("hex");

    let payload: Record<string, unknown>;
    if (sourceId) {
      const [row] = await app.db.select({ source: sources, media: mediaObjects, upload: uploads })
        .from(sources)
        .innerJoin(mediaObjects, eq(mediaObjects.id, sources.originalMediaId))
        .leftJoin(uploads, eq(uploads.sourceId, sources.id))
        .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
        .limit(1);
      if (!row || row.source.kind !== "upload" || row.media.deletedAt || row.upload?.status !== "completed") {
        throw app.httpErrors.badRequest("Сначала завершите загрузку файла");
      }
      payload = {
        sourceId,
        source: { kind: "s3", bucket: row.media.bucket, key: row.media.objectKey, mimeType: row.media.mimeType },
        title: typeof row.source.metadata.originalFileName === "string" ? row.source.metadata.originalFileName.slice(0, 180) : "Загруженное видео",
      };
    } else {
      payload = { url: normalizedUrl! };
    }

    // Keep a successful lookup for a short period. It makes repeated clicks
    // instant but does not treat remote metadata as durable project data.
    const [recent] = await app.db.select().from(jobs).where(and(
      eq(jobs.workspaceId, workspaceId),
      eq(jobs.type, "source_preview"),
      eq(jobs.status, "succeeded"),
      sourceId
        ? sql`${jobs.payload}->>'sourceId' = ${sourceId}`
        : sql`${jobs.payload}->>'url' = ${normalizedUrl}`,
      gt(jobs.completedAt, new Date(Date.now() - 15 * 60 * 1000)),
    )).orderBy(desc(jobs.completedAt)).limit(1);
    if (recent) return reply.send({
      id: recent.id,
      status: recent.status,
      result: await presentPreviewResult(recent.result),
    });

    const [job] = await app.db.insert(jobs).values({
      workspaceId,
      type: "source_preview",
      class: "io",
      payload,
      idempotencyKey: `source-preview:${preflightKey}:${randomUUID()}`,
      estimatedCost: "0.1",
      maxAttempts: 1,
    }).returning();
    return reply.code(202).send({ id: job.id, status: job.status, result: null });
  });

  app.get("/v1/media/source-previews/:jobId", { preHandler: app.requireWorkspace }, async (request) => {
    const { jobId } = request.params as { jobId: string };
    const { workspaceId } = request.authContext!;
    const [job] = await app.db.select().from(jobs).where(and(
      eq(jobs.id, jobId),
      eq(jobs.workspaceId, workspaceId),
      eq(jobs.type, "source_preview"),
    )).limit(1);
    if (!job) throw app.httpErrors.notFound("Проверка ссылки не найдена");
    return {
      id: job.id,
      status: job.status,
      result: job.status === "succeeded" ? await presentPreviewResult(job.result) : null,
      error: job.status === "failed" ? job.error : null,
    };
  });

  app.get("/v1/storage", { preHandler: app.requireWorkspace }, async (request) => {
    const { workspaceId } = request.authContext!;
    const [[workspace], rows] = await Promise.all([
      app.db.select({ planCode: workspaces.planCode })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1),
      app.db.select({
        kind: mediaObjects.kind,
        bytes: sql<number>`coalesce(sum(${mediaObjects.byteSize}), 0)::bigint`,
      })
        .from(mediaObjects)
        .where(and(
          eq(mediaObjects.workspaceId, workspaceId),
          isNull(mediaObjects.deletedAt),
          or(isNull(mediaObjects.expiresAt), gt(mediaObjects.expiresAt, new Date())),
        ))
        .groupBy(mediaObjects.kind),
    ]);
    if (!workspace) throw app.httpErrors.notFound("Workspace not found");
    const planCode = (workspace.planCode in productPlans ? workspace.planCode : "free") as PlanCode;
    const limitBytes = productPlans[planCode].storageBytes;
    const byKind = Object.fromEntries(rows.map((row) => [row.kind, Number(row.bytes)]));
    const usedBytes = Object.values(byKind).reduce((sum, value) => sum + value, 0);
    return {
      planCode,
      usedBytes,
      limitBytes,
      availableBytes: Math.max(0, limitBytes - usedBytes),
      usagePercent: limitBytes > 0 ? Math.min(100, usedBytes / limitBytes * 100) : 100,
      blocked: usedBytes >= limitBytes,
      byKind,
    };
  });

  app.get("/v1/media/youtube-metadata", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { url } = request.query as { url?: string };
    if (!url || !YOUTUBE_URL_PATTERN.test(url)) {
      throw app.httpErrors.badRequest("Нужна ссылка на видео YouTube");
    }

    const oembedResponse = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    ).catch(() => null);
    if (!oembedResponse || !oembedResponse.ok) {
      throw app.httpErrors.badRequest("Не удалось найти это видео — проверьте ссылку и доступ");
    }
    const oembed = (await oembedResponse.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };

    let durationSeconds: number | null = null;
    const env = getEnv();
    const videoId = extractVideoId(url);
    if (env.YOUTUBE_API_KEY && videoId) {
      try {
        const detailsResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails&key=${env.YOUTUBE_API_KEY}`,
        );
        if (detailsResponse.ok) {
          const details = (await detailsResponse.json()) as {
            items?: Array<{ contentDetails?: { duration?: string } }>;
          };
          const iso = details.items?.[0]?.contentDetails?.duration;
          durationSeconds = iso ? parseIso8601Duration(iso) : null;
        }
      } catch (error) {
        app.log.warn({ err: error }, "youtube duration lookup failed, continuing without it");
      }
    }

    return reply.send({
      title: oembed.title ?? null,
      authorName: oembed.author_name ?? null,
      thumbnailUrl: oembed.thumbnail_url ?? null,
      durationSeconds,
    });
  });
}
