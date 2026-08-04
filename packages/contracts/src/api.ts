import { z } from "zod";
import { styleConfigSchema } from "./media.js";
import { engineCapabilitySchema, jobRequirementsSchema } from "./hve-v2.js";

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

/**
 * Every hostname the media-worker's downloader (yt-dlp) is whitelisted to
 * import from — see services/media-worker/src/fourshort_worker/stages.py.
 * The wire-level `kind: "youtube"` name predates this and is kept as-is
 * (renaming it would touch the DB source_kind enum and every route that
 * reads it) even though it now accepts more than YouTube.
 */
export const SUPPORTED_SOURCE_HOSTS = [
  "youtube.com", "youtu.be",
  "vk.com", "vkvideo.ru",
  "rutube.ru",
  "twitch.tv", "clips.twitch.tv",
] as const;

export const youtubeUrlSchema = z.string().url().refine((value) => {
  const hostname = new URL(value).hostname.replace(/^www\./, "").replace(/^m\./, "");
  return SUPPORTED_SOURCE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}, "Нужна ссылка на YouTube, VK Видео, RuTube или Twitch");

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(180),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("youtube"), url: youtubeUrlSchema }),
    z.object({
      kind: z.literal("upload"),
      uploadId: z.string().uuid(),
      originalFileName: z.string().min(1).max(512),
    }),
    z.object({
      kind: z.literal("existing"),
      sourceId: z.string().uuid(),
    }),
  ]),
  momentSettings: z.object({
    mode: z.enum(["best", "opinions", "tips", "stories", "qa", "product", "custom", "uniform", "manual"]),
    query: z.string().trim().max(1000).optional(),
    count: z.union([z.literal("recommended"), z.number().int().min(1).max(50)]),
    durationMinSeconds: z.number().int().min(10).max(240),
    durationMaxSeconds: z.number().int().min(15).max(300),
    diversity: z.enum(["low", "medium", "high"]).default("high"),
    selectionStrictness: z.enum(["wide", "balanced", "strict"]).default("balanced"),
    allowThoughtCompletion: z.boolean().default(true),
    sourceRange: z.object({
      startSeconds: z.number().int().nonnegative(),
      endSeconds: z.number().int().positive(),
    }).refine((value) => value.endSeconds > value.startSeconds, {
      message: "Конец диапазона должен быть после начала",
    }).optional(),
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

export const updateMomentSchema = z.object({
  selected: z.boolean().optional(),
  title: z.string().trim().min(1).max(180).optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().positive().optional(),
  speakerId: z.string().trim().max(120).nullable().optional(),
  layoutOverride: z.record(z.string(), z.unknown()).nullable().optional(),
}).refine((value) => value.startMs == null || value.endMs == null || value.endMs > value.startMs, {
  message: "Конец момента должен быть после начала",
});

export const createMomentSearchSchema = z.object({
  mode: z.enum(["best", "opinions", "tips", "stories", "qa", "product", "custom", "uniform", "manual"]),
  query: z.string().trim().max(1000).optional(),
  count: z.union([z.literal("recommended"), z.number().int().min(1).max(50)]),
  durationMinSeconds: z.number().int().min(10).max(240),
  durationMaxSeconds: z.number().int().min(15).max(300),
  diversity: z.enum(["low", "medium", "high"]).default("high"),
  selectionStrictness: z.enum(["wide", "balanced", "strict"]).default("balanced"),
  allowThoughtCompletion: z.boolean().default(true),
  excludedTopics: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  resultMode: z.enum(["append", "replace"]).default("append"),
}).refine((value) => value.durationMaxSeconds >= value.durationMinSeconds, {
  message: "Максимальная длительность должна быть больше минимальной",
}).refine((value) => value.mode !== "custom" || Boolean(value.query), {
  message: "Для своего запроса нужен текст",
});

export const createTranscriptRevisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("replace_text"),
      segmentId: z.string().uuid(),
      text: z.string().trim().min(1).max(10_000),
    }),
    z.object({
      type: z.literal("hide_word"),
      segmentId: z.string().uuid(),
      wordIndex: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("cut_word"),
      segmentId: z.string().uuid(),
      wordIndex: z.number().int().nonnegative(),
    }),
  ])).min(1).max(500),
});

export const updateClipSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(180).optional(),
  socialTitle: z.string().trim().max(180).optional(),
  socialDescription: z.string().trim().max(2000).optional(),
  edl: z.record(z.string(), z.unknown()),
  scope: z.enum(["clip", "selected_clips", "project", "style", "new_style"]).default("clip"),
  selectedClipIds: z.array(z.string().uuid()).max(100).default([]),
  styleName: z.string().trim().min(1).max(80).optional(),
}).refine((value) => value.scope !== "selected_clips" || value.selectedClipIds.length > 0, {
  message: "Выберите клипы для массового применения",
  path: ["selectedClipIds"],
}).refine((value) => value.scope !== "new_style" || Boolean(value.styleName), {
  message: "Укажите название нового стиля",
  path: ["styleName"],
});

export const generativeQuoteSchema = z.object({
  kind: z.enum(["b_roll", "music", "translation", "dubbing", "image", "video"]),
  clipId: z.string().uuid(),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const confirmGenerativeOperationSchema = z.object({
  operationId: z.string().uuid(),
  confirmed: z.literal(true),
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

/** Static brand assets use the same resumable S3 transport as source media,
 * but remain a separate product capability with a deliberately smaller and
 * executable MIME allowlist. */
const staticBrandAssetUploadSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(["logo", "banner", "image"]),
  fileName: z.string().min(1).max(512),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().positive().max(25 * 1024 * 1024),
  partSize: z.number().int().min(5 * 1024 * 1024).max(16 * 1024 * 1024).default(8 * 1024 * 1024),
});

/**
 * Timed media is deliberately a separate upload class. A claimed MIME type
 * does not make it executable: worker-side ffprobe plus a full decode must
 * mark the asset verified before the HVE planner can resolve it.
 */
const timedBrandAssetUploadSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(["video", "broll", "outro"]),
  fileName: z.string().min(1).max(512),
  mimeType: z.literal("video/mp4"),
  byteSize: z.number().int().positive().max(100 * 1024 * 1024),
  partSize: z.number().int().min(5 * 1024 * 1024).max(16 * 1024 * 1024).default(8 * 1024 * 1024),
});

export const createBrandAssetUploadSchema = z.union([
  staticBrandAssetUploadSchema,
  timedBrandAssetUploadSchema,
]);

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

export const jobTypeSchema = z.enum([
  "probe", "youtube_import", "extract_audio", "speech_to_text", "generate_proxy",
  "verify_brand_video", "find_moments", "analyze_visual", "analyze_clip_visual", "face_track",
  "render_clip", "validate_render", "zip_project", "cleanup",
]);

export const enqueueJobSchema = z.object({
  projectId: z.string().uuid().optional(),
  clipId: z.string().uuid().optional(),
  type: jobTypeSchema,
  class: z.enum(["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"]),
  payload: z.record(z.string(), z.unknown()),
  artifactHash: z.string().max(256).optional(),
  estimatedCost: z.number().positive().max(100_000).default(1),
  requirements: jobRequirementsSchema.optional(),
});

export const workerClaimSchema = z.object({
  workerId: z.string().min(1).max(120),
  classes: z.array(z.enum(["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"])).min(1),
  leaseSeconds: z.number().int().min(30).max(600).default(120),
});

// A deployed v1 worker announces only the classes it can claim. Accept this
// during a rolling HVE deployment, but never schedule a v2 job with explicit
// resource/model requirements to it (the scheduler fails that match closed).
const legacyWorkerCapabilitySchema = z.object({
  classes: z.array(z.enum(["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"])).min(1),
}).passthrough();

export const workerRegistrationSchema = z.object({
  workerId: z.string().min(1).max(120),
  version: z.string().min(1).max(80),
  capabilities: z.union([engineCapabilitySchema.passthrough(), legacyWorkerCapabilitySchema]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const workerHeartbeatSchema = z.object({
  workerId: z.string().min(1).max(120),
  leaseSeconds: z.number().int().min(30).max(600).default(120),
  checkpoint: z.string().max(120).optional(),
  progress: z.object({
    completed: z.number().nonnegative(),
    total: z.number().positive().optional(),
    unit: z.enum(["bytes", "milliseconds", "frames", "steps"]).optional(),
  // Older workers sent an explicit JSON null before the first measurable
  // progress sample. Treat it as omitted at the HTTP boundary so a rolling
  // deploy cannot turn a media job into a 500.
  }).nullish(),
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
export type UpdateMomentInput = z.infer<typeof updateMomentSchema>;
export type CreateMomentSearchInput = z.infer<typeof createMomentSearchSchema>;
export type CreateTranscriptRevisionInput = z.infer<typeof createTranscriptRevisionSchema>;
export type UpdateClipInput = z.infer<typeof updateClipSchema>;
export type GenerativeQuoteInput = z.infer<typeof generativeQuoteSchema>;
export type ConfirmGenerativeOperationInput = z.infer<typeof confirmGenerativeOperationSchema>;
