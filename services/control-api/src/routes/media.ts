import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { mediaObjects, workspaces } from "../../../../db/schema.js";
import { productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import { getEnv } from "../env.js";

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
