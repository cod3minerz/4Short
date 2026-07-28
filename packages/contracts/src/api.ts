import { z } from "zod";
import { styleConfigSchema } from "./media.js";

export const projectStatusSchema = z.enum([
  "draft",
  "uploading",
  "importing",
  "probing",
  "transcribing",
  "finding_moments",
  "review_required",
  "rendering",
  "ready",
  "partially_ready",
  "failed",
  "archived",
]);

export const youtubeUrlSchema = z.string().url().refine((value) => {
  const hostname = new URL(value).hostname.replace(/^www\./, "");
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
}, "Нужна ссылка на YouTube");

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(180),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("youtube"), url: youtubeUrlSchema }),
    z.object({
      kind: z.literal("upload"),
      uploadId: z.string().uuid(),
      originalFileName: z.string().min(1).max(512),
    }),
  ]),
  momentSettings: z.object({
    mode: z.enum(["best", "opinions", "tips", "stories", "qa", "product", "custom"]),
    query: z.string().trim().max(1000).optional(),
    count: z.union([z.literal("recommended"), z.number().int().min(1).max(50)]),
    durationMinSeconds: z.number().int().min(10).max(240),
    durationMaxSeconds: z.number().int().min(15).max(300),
    diversity: z.enum(["low", "medium", "high"]).default("high"),
    excludedTopics: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  }).refine((value) => value.durationMaxSeconds >= value.durationMinSeconds, {
    message: "Максимальная длительность должна быть больше минимальной",
  }).refine((value) => value.mode !== "custom" || Boolean(value.query), {
    message: "Для своего запроса нужен текст",
  }),
  styleVersionId: z.string().uuid(),
  projectOverrides: styleConfigSchema.partial().optional(),
});

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const createStyleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(""),
  config: styleConfigSchema,
  makeDefault: z.boolean().default(false),
});

export const updateStyleSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional(),
  config: styleConfigSchema,
  makeDefault: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
});

export const createUploadSchema = z.object({
  fileName: z.string().min(1).max(512),
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"]),
  byteSize: z.number().int().positive().max(10 * 1024 * 1024 * 1024),
  partSize: z.number().int().min(8 * 1024 * 1024).max(16 * 1024 * 1024).default(12 * 1024 * 1024),
});

export const completeUploadSchema = z.object({
  parts: z.array(z.object({
    partNumber: z.number().int().min(1).max(10_000),
    etag: z.string().min(1),
  })).min(1),
});

export const reserveMinutesSchema = z.object({
  projectId: z.string().uuid().optional(),
  sourceFingerprint: z.string().min(16).max(128),
  seconds: z.number().int().positive().max(4 * 60 * 60),
});

export const enqueueJobSchema = z.object({
  projectId: z.string().uuid().optional(),
  clipId: z.string().uuid().optional(),
  type: z.enum(["probe", "youtube_import", "extract_audio", "speech_to_text", "find_moments", "face_track", "render_clip", "validate_render", "zip_project", "cleanup"]),
  class: z.enum(["io", "provider", "cpu_light", "cpu_heavy"]),
  payload: z.record(z.string(), z.unknown()),
  artifactHash: z.string().max(256).optional(),
  estimatedCost: z.number().positive().max(100_000).default(1),
});

export const workerClaimSchema = z.object({
  workerId: z.string().min(1).max(120),
  classes: z.array(z.enum(["io", "provider", "cpu_light", "cpu_heavy"])).min(1),
  leaseSeconds: z.number().int().min(30).max(600).default(120),
});

export const workerHeartbeatSchema = z.object({
  workerId: z.string().min(1).max(120),
  leaseSeconds: z.number().int().min(30).max(600).default(120),
  checkpoint: z.string().max(120).optional(),
  progress: z.object({
    completed: z.number().nonnegative(),
    total: z.number().positive().optional(),
    unit: z.enum(["bytes", "milliseconds", "frames", "steps"]).optional(),
  }).optional(),
});

export const jobCompletionSchema = z.object({
  workerId: z.string().min(1).max(120),
  result: z.record(z.string(), z.unknown()).default({}),
  metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const jobFailureSchema = z.object({
  workerId: z.string().min(1).max(120),
  retryable: z.boolean(),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(1000),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateStyleInput = z.infer<typeof createStyleSchema>;
export type UpdateStyleInput = z.infer<typeof updateStyleSchema>;
