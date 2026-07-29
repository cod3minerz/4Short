import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../env.js";

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
