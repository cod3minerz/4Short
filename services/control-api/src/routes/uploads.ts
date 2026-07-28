import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { completeUploadSchema, createUploadSchema } from "../../../../packages/contracts/src/index.js";
import { mediaObjects, sources, uploads } from "../../../../db/schema.js";
import { getEnv } from "../env.js";
import { beginMultipartUpload, completeMultipartUpload, signUploadPart } from "../lib/s3.js";

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/v1/uploads", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = createUploadSchema.parse(request.body);
    const { workspaceId } = request.authContext!;
    const env = getEnv();
    const mediaId = randomUUID();
    const objectKey = `${workspaceId}/${mediaId}/source`;
    const providerUploadId = await beginMultipartUpload(env.S3_RAW_BUCKET, objectKey, body.mimeType);

    const result = await app.db.transaction(async (tx) => {
      const [media] = await tx.insert(mediaObjects).values({
        id: mediaId,
        workspaceId,
        bucket: env.S3_RAW_BUCKET,
        objectKey,
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
    if (row.upload.status === "completed") return { uploadId, sourceId: row.upload.sourceId, status: "completed" };

    await completeMultipartUpload({
      bucket: row.media.bucket,
      key: row.media.objectKey,
      uploadId: row.upload.providerUploadId,
      parts: body.parts,
    });
    await app.db.update(uploads).set({
      status: "completed",
      completedParts: body.parts,
      updatedAt: new Date(),
    }).where(eq(uploads.id, uploadId));
    return { uploadId, sourceId: row.upload.sourceId, status: "completed" };
  });
}
