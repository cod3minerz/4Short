import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { completeUploadSchema, createUploadSchema } from "../../../../packages/contracts/src/index.js";
import { mediaObjects, sources, uploads, workspaces } from "../../../../db/schema.js";
import { productPlans, type PlanCode } from "../../../../packages/product-config/src/index.js";
import {
  beginMultipartUpload,
  completeMultipartUpload,
  s3ObjectLocation,
  signUploadPart,
} from "../lib/s3.js";

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/v1/uploads", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createUploadSchema.parse(request.body);
    const { workspaceId } = request.authContext!;

    const result = await app.db.transaction(async (tx) => {
      // Reserving a multipart upload also reserves its bytes. Locking the
      // workspace makes the quota check safe when several tabs start uploads
      // at the same time.
      const [workspace] = await tx.select({ planCode: workspaces.planCode })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for("update")
        .limit(1);
      if (!workspace) throw app.httpErrors.notFound("Workspace not found");
      const [usage] = await tx.select({
        bytes: sql<number>`coalesce(sum(${mediaObjects.byteSize}), 0)::bigint`,
      })
        .from(mediaObjects)
        .where(and(
          eq(mediaObjects.workspaceId, workspaceId),
          isNull(mediaObjects.deletedAt),
          or(isNull(mediaObjects.expiresAt), gt(mediaObjects.expiresAt, new Date())),
        ));
      const planCode = (workspace.planCode in productPlans ? workspace.planCode : "free") as PlanCode;
      const limitBytes = productPlans[planCode].storageBytes;
      const usedBytes = Number(usage?.bytes ?? 0);
      if (usedBytes + body.byteSize > limitBytes) {
        const quotaError = new Error("В хранилище недостаточно места для этого видео") as Error & { statusCode: number };
        quotaError.statusCode = 413;
        throw quotaError;
      }

      const mediaId = randomUUID();
      const object = s3ObjectLocation("raw", `${workspaceId}/${mediaId}/source`);
      const providerUploadId = await beginMultipartUpload(object.bucket, object.key, body.mimeType);
      const [media] = await tx.insert(mediaObjects).values({
        id: mediaId,
        workspaceId,
        bucket: object.bucket,
        objectKey: object.key,
        kind: "source",
        mimeType: body.mimeType,
        byteSize: body.byteSize,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }).returning();
      const [source] = await tx.insert(sources).values({
        workspaceId,
        kind: "upload",
        originalMediaId: media.id,
        metadata: { originalFileName: body.fileName },
      }).returning();
      const [upload] = await tx.insert(uploads).values({
        workspaceId,
        sourceId: source.id,
        mediaObjectId: media.id,
        providerUploadId,
        partSize: body.partSize,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }).returning();
      return { upload, source, media };
    });

    return reply.code(201).send({
      uploadId: result.upload.id,
      sourceId: result.source.id,
      partSize: body.partSize,
      partCount: Math.ceil(body.byteSize / body.partSize),
      expiresAt: result.upload.expiresAt,
    });
  });

  app.post("/v1/uploads/:uploadId/parts", { preHandler: app.requireWorkspace }, async (request) => {
    const { uploadId } = request.params as { uploadId: string };
    const partNumbers = Array.isArray((request.body as { partNumbers?: unknown })?.partNumbers)
      ? (request.body as { partNumbers: unknown[] }).partNumbers
          .map(Number)
          .filter((value) => Number.isInteger(value) && value > 0 && value <= 10_000)
          .slice(0, 50)
      : [];
    if (!partNumbers.length) throw app.httpErrors.badRequest("partNumbers is required");

    const [upload] = await app.db.select({
      upload: uploads,
      media: mediaObjects,
    }).from(uploads)
      .innerJoin(mediaObjects, eq(mediaObjects.id, uploads.mediaObjectId))
      .where(and(
        eq(uploads.id, uploadId),
        eq(uploads.workspaceId, request.authContext!.workspaceId),
        eq(uploads.status, "pending"),
      ))
      .limit(1);
    if (!upload) throw app.httpErrors.notFound("Upload not found");

    const parts = await Promise.all(partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await signUploadPart({
        bucket: upload.media.bucket,
        key: upload.media.objectKey,
        uploadId: upload.upload.providerUploadId,
        partNumber,
      }),
    })));
    return { parts };
  });

  app.post("/v1/uploads/:uploadId/complete", { preHandler: app.requireWorkspace }, async (request) => {
    const body = completeUploadSchema.parse(request.body);
    const { uploadId } = request.params as { uploadId: string };
    const [row] = await app.db.select({
      upload: uploads,
      media: mediaObjects,
    }).from(uploads)
      .innerJoin(mediaObjects, eq(mediaObjects.id, uploads.mediaObjectId))
      .where(and(
        eq(uploads.id, uploadId),
        eq(uploads.workspaceId, request.authContext!.workspaceId),
      ))
      .limit(1);
    if (!row) throw app.httpErrors.notFound("Upload not found");
    // Brand assets have a separate completion boundary which verifies their
    // bytes and records their SHA-256 before HVE can consume them. Never let
    // the generic source completion route bypass that invariant.
    if (!row.upload.sourceId || row.media.kind === "brand_asset") {
      throw app.httpErrors.conflict("Complete brand assets through /v1/brand-assets/uploads/:uploadId/complete");
    }
    if (row.upload.status === "completed") return { uploadId, sourceId: row.upload.sourceId, status: "completed" };

    await completeMultipartUpload({
      bucket: row.media.bucket,
      key: row.media.objectKey,
      uploadId: row.upload.providerUploadId,
      parts: body.parts,
    });
    await app.db.transaction(async (tx) => {
      const [workspace] = await tx.select({ planCode: workspaces.planCode })
        .from(workspaces)
        .where(eq(workspaces.id, request.authContext!.workspaceId))
        .limit(1);
      if (!workspace) throw app.httpErrors.notFound("Workspace not found");
      const planCode = (workspace.planCode in productPlans ? workspace.planCode : "free") as PlanCode;
      const sourceExpiresAt = new Date(Date.now() + productPlans[planCode].sourceRetentionDays * 24 * 60 * 60 * 1000);
      await Promise.all([
        tx.update(uploads).set({
          status: "completed",
          completedParts: body.parts,
          updatedAt: new Date(),
        }).where(eq(uploads.id, uploadId)),
        tx.update(mediaObjects).set({ expiresAt: sourceExpiresAt })
          .where(eq(mediaObjects.id, row.media.id)),
      ]);
    });
    return { uploadId, sourceId: row.upload.sourceId, status: "completed" };
  });
}
