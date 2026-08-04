import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../env.js";
import { decodeVerifiedJsonArtifact } from "./verified-json-artifact.js";

export { decodeVerifiedJsonArtifact } from "./verified-json-artifact.js";

const env = getEnv();

export type S3ArtifactKind = "raw" | "proxy" | "derived" | "assets";

const legacyBuckets: Record<S3ArtifactKind, string> = {
  raw: env.S3_RAW_BUCKET,
  proxy: env.S3_PROXY_BUCKET,
  derived: env.S3_DERIVED_BUCKET,
  assets: env.S3_ASSETS_BUCKET,
};

const prefixes: Record<S3ArtifactKind, string> = {
  raw: env.S3_RAW_PREFIX,
  proxy: env.S3_PROXY_PREFIX,
  derived: env.S3_DERIVED_PREFIX,
  assets: env.S3_ASSETS_PREFIX,
};

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export function s3ObjectLocation(kind: S3ArtifactKind, key: string) {
  const prefix = prefixes[kind].replace(/^\/+|\/+$/g, "");
  const normalizedKey = key.replace(/^\/+/, "");
  return {
    bucket: env.S3_BUCKET ?? legacyBuckets[kind],
    key: prefix ? `${prefix}/${normalizedKey}` : normalizedKey,
  };
}

export async function beginMultipartUpload(bucket: string, key: string, contentType: string) {
  const result = await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(env.S3_SERVER_SIDE_ENCRYPTION === "AES256"
      ? { ServerSideEncryption: "AES256" as const }
      : {}),
  }));
  if (!result.UploadId) throw new Error("S3 did not return UploadId");
  return result.UploadId;
}

export async function signUploadPart(input: {
  bucket: string;
  key: string;
  uploadId: string;
  partNumber: number;
}) {
  return getSignedUrl(s3, new UploadPartCommand({
    Bucket: input.bucket,
    Key: input.key,
    UploadId: input.uploadId,
    PartNumber: input.partNumber,
  }), { expiresIn: 60 * 30 });
}

export async function completeMultipartUpload(input: {
  bucket: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  return s3.send(new CompleteMultipartUploadCommand({
    Bucket: input.bucket,
    Key: input.key,
    UploadId: input.uploadId,
    MultipartUpload: {
      Parts: input.parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
    },
  }));
}

export async function signDownload(bucket: string, key: string, seconds = 900) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: seconds,
  });
}

export async function deletePrivateObject(bucket: string, key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Byte-level validation for the first executable brand-asset formats.
 * Object metadata is never trusted as proof of the media type. */
export async function readVerifiedStaticImage(input: {
  bucket: string;
  key: string;
  maxBytes?: number;
}): Promise<{ sha256: string; byteSize: number; mimeType: "image/png" | "image/jpeg" | "image/webp" }> {
  const maxBytes = input.maxBytes ?? 25 * 1024 * 1024;
  const response = await s3.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
  if (response.ContentLength !== undefined && response.ContentLength > maxBytes) throw new Error("HVE_STATIC_ASSET_TOO_LARGE");
  const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error("HVE_STATIC_ASSET_BODY_UNAVAILABLE");
  const bytes = await body.transformToByteArray();
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error("HVE_STATIC_ASSET_TOO_LARGE");
  const png = bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const mimeType = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!mimeType) throw new Error("HVE_STATIC_ASSET_SIGNATURE_INVALID");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.byteLength, mimeType };
}

/**
 * Fetches a small, private JSON artifact for control-plane planning. This is
 * deliberately not a generic media download: the caller supplies a database
 * hash and a strict byte limit, so a corrupted or unexpectedly large object
 * cannot be treated as a visual-analysis fact.
 */
export async function readVerifiedJsonArtifact(input: {
  bucket: string;
  key: string;
  sha256: string;
  maxBytes?: number;
}): Promise<unknown> {
  const maxBytes = input.maxBytes ?? 16 * 1024 * 1024;
  const response = await s3.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
  if (response.ContentLength !== undefined && response.ContentLength > maxBytes) {
    throw new Error("S3_JSON_ARTIFACT_TOO_LARGE");
  }
  const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error("S3_JSON_ARTIFACT_BODY_UNAVAILABLE");
  const bytes = await body.transformToByteArray();
  return decodeVerifiedJsonArtifact(bytes, { sha256: input.sha256, maxBytes });
}
