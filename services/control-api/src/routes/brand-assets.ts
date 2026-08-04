import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { completeUploadSchema, createBrandAssetUploadSchema } from "../../../../packages/contracts/src/index.js";
import { brandAssets, jobs, mediaObjects, uploads, workspaces } from "../../../../db/schema.js";
import { productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import {
  beginMultipartUpload,
  completeMultipartUpload,
  deletePrivateObject,
  readVerifiedStaticImage,
  s3ObjectLocation,
} from "../lib/s3.js";

/**
 * Private static branding pipeline.  It intentionally does not accept a URL:
 * the browser uploads directly to the workspace's private S3 namespace, the
 * API checks bytes after completion, and only then is a brand_asset visible to
 * HVE planning. Timed media has its own worker verification boundary and is
 * never made planner-visible solely because an S3 multipart upload completed.
 */
export async function brandAssetRoutes(app: FastifyInstance) {
  app.post("/v1/brand-assets/uploads", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createBrandAssetUploadSchema.parse(request.body);
    const { workspaceId } = request.authContext!;
    const result = await app.db.transaction(async (tx) => {
      const [workspace] = await tx.select({ planCode: workspaces.planCode })
        .from(workspaces).where(eq(workspaces.id, workspaceId)).for("update").limit(1);
      if (!workspace) throw app.httpErrors.notFound("Workspace not found");
      const [usage] = await tx.select({
        bytes: sql<number>`coalesce(sum(${mediaObjects.byteSize}), 0)::bigint`,
      }).from(mediaObjects).where(and(
        eq(mediaObjects.workspaceId, workspaceId),
        isNull(mediaObjects.deletedAt),
        or(isNull(mediaObjects.expiresAt), gt(mediaObjects.expiresAt, new Date())),
      ));
      const planCode = (workspace.planCode in productPlans ? workspace.planCode : "free") as PlanCode;
      if (Number(usage?.bytes ?? 0) + body.byteSize > productPlans[planCode].storageBytes) {
        const error = new Error("В хранилище недостаточно места для этого ассета") as Error & { statusCode: number };
        error.statusCode = 413;
        throw error;
      }
      const mediaId = randomUUID();
      const object = s3ObjectLocation("assets", `${workspaceId}/${mediaId}/original`);
      const providerUploadId = await beginMultipartUpload(object.bucket, object.key, body.mimeType);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [media] = await tx.insert(mediaObjects).values({
        id: mediaId,
        workspaceId,
        bucket: object.bucket,
        objectKey: object.key,
        kind: "brand_asset",
        mimeType: body.mimeType,
        byteSize: body.byteSize,
        expiresAt,
      }).returning();
      const [upload] = await tx.insert(uploads).values({
        workspaceId,
        mediaObjectId: media.id,
        providerUploadId,
        partSize: body.partSize,
        expiresAt,
      }).returning();
      const [asset] = await tx.insert(brandAssets).values({
        workspaceId,
        mediaObjectId: media.id,
        kind: body.kind,
        name: body.name,
        metadata: {
          originalFileName: body.fileName,
          uploadStatus: "pending",
          verificationKind: ["video", "broll", "outro"].includes(body.kind) ? "timed_media" : "static_image",
        },
      }).returning();
      return { upload, media, asset };
    });
    return reply.code(201).send({
      uploadId: result.upload.id,
      partSize: body.partSize,
      partCount: Math.ceil(body.byteSize / body.partSize),
      expiresAt: result.upload.expiresAt,
      assetId: result.asset.id,
    });
  });

  app.post("/v1/brand-assets/uploads/:uploadId/complete", { preHandler: app.requireWorkspace }, async (request) => {
    const body = completeUploadSchema.parse(request.body);
    const { uploadId } = request.params as { uploadId: string };
    const { workspaceId } = request.authContext!;
    const [row] = await app.db.select({ upload: uploads, media: mediaObjects })
      .from(uploads)
      .innerJoin(mediaObjects, eq(mediaObjects.id, uploads.mediaObjectId))
      .where(and(
        eq(uploads.id, uploadId),
        eq(uploads.workspaceId, workspaceId),
        isNull(uploads.sourceId),
        eq(mediaObjects.kind, "brand_asset"),
      )).limit(1);
    if (!row) throw app.httpErrors.notFound("Brand asset upload not found");

    const [existing] = await app.db.select().from(brandAssets)
      .where(and(eq(brandAssets.mediaObjectId, row.media.id), eq(brandAssets.workspaceId, workspaceId))).limit(1);
    if (existing && row.upload.status === "completed" && row.media.sha256) {
      return { uploadId, asset: existing, status: "completed" };
    }
    if (existing && row.upload.status === "verifying") {
      const [verificationJob] = await app.db.select({ id: jobs.id, status: jobs.status })
        .from(jobs)
        .where(and(
          eq(jobs.workspaceId, workspaceId),
          eq(jobs.type, "verify_brand_video"),
          sql`${jobs.payload}->>'assetId' = ${existing.id}`,
        ))
        .orderBy(sql`${jobs.createdAt} desc`)
        .limit(1);
      return { uploadId, asset: existing, status: "verifying", jobId: verificationJob?.id ?? null, jobStatus: verificationJob?.status ?? null };
    }
    if (row.upload.status !== "pending" && row.upload.status !== "completed") {
      throw app.httpErrors.conflict("Brand asset upload is not pending");
    }
    if (row.upload.status === "pending") {
      await completeMultipartUpload({
        bucket: row.media.bucket,
        key: row.media.objectKey,
        uploadId: row.upload.providerUploadId,
        parts: body.parts,
      });
    }

    if (existing && ["video", "broll", "outro"].includes(existing.kind)) {
      const result = await app.db.transaction(async (tx) => {
        await tx.update(uploads).set({
          status: "verifying", completedParts: body.parts, updatedAt: new Date(),
        }).where(eq(uploads.id, uploadId));
        await tx.update(brandAssets).set({
          metadata: {
            ...(existing.metadata ?? {}),
            uploadStatus: "verifying",
            verificationKind: "timed_media",
          },
          updatedAt: new Date(),
        }).where(eq(brandAssets.id, existing.id));
        const [verificationJob] = await tx.insert(jobs).values({
          workspaceId,
          type: "verify_brand_video",
          class: "cpu_light",
          payload: {
            assetId: existing.id,
            mediaObjectId: row.media.id,
            source: { kind: "s3", bucket: row.media.bucket, key: row.media.objectKey },
            declaredByteSize: row.media.byteSize,
          },
          idempotencyKey: `brand-asset:${existing.id}:verify-timed-media:v1`,
          artifactHash: null,
          estimatedCost: "1",
        }).onConflictDoUpdate({
          target: [jobs.workspaceId, jobs.idempotencyKey],
          set: { updatedAt: new Date() },
        }).returning();
        return verificationJob;
      });
      return { uploadId, asset: existing, status: "verifying", jobId: result.id, jobStatus: result.status };
    }

    let verified: Awaited<ReturnType<typeof readVerifiedStaticImage>>;
    try {
      verified = await readVerifiedStaticImage({ bucket: row.media.bucket, key: row.media.objectKey });
      if (verified.mimeType !== row.media.mimeType || verified.byteSize !== row.media.byteSize) {
        throw new Error("HVE_STATIC_ASSET_METADATA_MISMATCH");
      }
    } catch (error) {
      await deletePrivateObject(row.media.bucket, row.media.objectKey).catch(() => undefined);
      await app.db.transaction(async (tx) => {
        await tx.update(uploads).set({ status: "failed", updatedAt: new Date() }).where(eq(uploads.id, uploadId));
        await tx.update(mediaObjects).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(mediaObjects.id, row.media.id));
      });
      throw app.httpErrors.badRequest(error instanceof Error ? error.message : "HVE_STATIC_ASSET_INVALID");
    }

    const result = await app.db.transaction(async (tx) => {
      await tx.update(uploads).set({
        status: "completed", completedParts: body.parts, updatedAt: new Date(),
      }).where(eq(uploads.id, uploadId));
      const [media] = await tx.update(mediaObjects).set({
        sha256: verified.sha256,
        mimeType: verified.mimeType,
        byteSize: verified.byteSize,
        expiresAt: null,
        updatedAt: new Date(),
      }).where(eq(mediaObjects.id, row.media.id)).returning();
      await tx.update(brandAssets).set({
        metadata: { verifiedMimeType: verified.mimeType, sha256: verified.sha256, uploadStatus: "completed" },
        updatedAt: new Date(),
      }).where(and(eq(brandAssets.mediaObjectId, row.media.id), eq(brandAssets.workspaceId, workspaceId)));
      const [asset] = await tx.select().from(brandAssets)
        .where(and(eq(brandAssets.mediaObjectId, row.media.id), eq(brandAssets.workspaceId, workspaceId))).limit(1);
      if (!asset || !media) throw app.httpErrors.conflict("HVE_STATIC_ASSET_CREATE_FAILED");
      return { asset, media };
    });
    return { uploadId, asset: result.asset, status: "completed" };
  });
}
