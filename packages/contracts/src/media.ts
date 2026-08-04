import { z } from "zod";

export const timeRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).refine((value) => value.endMs > value.startMs, {
  message: "endMs must be greater than startMs",
});

export const cropKeyframeSchema = z.object({
  atMs: z.number().int().nonnegative(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
  confidence: z.number().min(0).max(1).optional(),
});

export const faceTrackSchema = z.object({
  trackId: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
  keyframes: z.array(cropKeyframeSchema).min(1).max(10_000),
});

export const layoutConfigSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto"), safeFallback: z.enum(["static_crop", "blur_background"]).default("static_crop") }),
  z.object({ mode: z.literal("active_speaker"), smoothing: z.number().min(0).max(1).default(0.82) }),
  z.object({ mode: z.literal("static_crop"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(3) }),
  z.object({ mode: z.literal("two_speakers"), split: z.enum(["horizontal", "vertical"]).default("horizontal") }),
  z.object({ mode: z.literal("blur_background"), blur: z.number().min(8).max(80).default(32) }),
  z.object({ mode: z.literal("video_image"), assetId: z.string().uuid(), videoPosition: z.enum(["top", "bottom", "left", "right"]) }),
  z.object({ mode: z.literal("picture_in_picture"), inset: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]) }),
  z.object({ mode: z.literal("screen_gameplay"), facePosition: z.enum(["top", "bottom"]).default("top") }),
]);

export const subtitleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["line", "active_word", "karaoke", "word_by_word"]).default("active_word"),
  // Keep every persisted picker identity distinct. `mode` controls timing;
  // `preset` preserves the visual choice for deterministic re-editing.
  // `pulse` remains readable for existing saved styles.
  preset: z.enum(["clean", "bold", "pulse", "karaoke", "active_word", "word_pop", "minimal_box", "speaker_colors"]).default("clean"),
  fontAssetId: z.string().uuid().optional(),
  fontFamily: z.string().min(1).max(120).default("Manrope"),
  fontSize: z.number().int().min(28).max(112).default(58),
  fontWeight: z.number().int().min(400).max(900).default(800),
  uppercase: z.boolean().default(false),
  maxWordsPerLine: z.number().int().min(1).max(12).default(5),
  maxLines: z.number().int().min(1).max(3).default(2),
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  safeMarginPx: z.number().int().min(24).max(320).default(160),
  align: z.enum(["left", "center", "right"]).default("center"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#ffffff"),
  activeColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#10b8f4"),
  outlineColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#06131a"),
  outlinePx: z.number().min(0).max(12).default(4),
  shadow: z.boolean().default(true),
  background: z.boolean().default(false),
  punctuation: z.boolean().default(true),
  emoji: z.boolean().default(false),
  censorWords: z.array(z.string().min(1).max(80)).max(100).default([]),
});

export const timedLayerSchema = z.object({
  assetId: z.string().uuid().optional(),
  text: z.string().max(240).optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  anchor: z.enum([
    "top_left", "top_center", "top_right",
    "center_left", "center", "center_right",
    "bottom_left", "bottom_center", "bottom_right",
  ]),
  widthPercent: z.number().min(5).max(100).default(40),
  marginPx: z.number().int().min(0).max(320).default(48),
  opacity: z.number().min(0).max(1).default(1),
  radiusPx: z.number().int().min(0).max(96).default(20),
  shadow: z.boolean().default(false),
  loop: z.boolean().default(false),
}).refine((value) => value.endMs > value.startMs, {
  message: "layer endMs must be greater than startMs",
});

export const silenceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minimumMs: z.number().int().min(250).max(5000).default(800),
  beforePaddingMs: z.number().int().min(0).max(500).default(100),
  afterPaddingMs: z.number().int().min(0).max(500).default(120),
  // HVE currently executes cuts in a shared audio/video time map. Keep the
  // default at zero until a crossfade is represented in that immutable plan;
  // a default that the worker cannot execute would be a silent media defect.
  crossfadeMs: z.number().int().min(0).max(120).default(0),
});

export const exportConfigSchema = z.object({
  width: z.number().int().positive().default(1080),
  height: z.number().int().positive().default(1920),
  fps: z.number().int().min(24).max(30).default(30),
  videoCodec: z.literal("h264").default("h264"),
  audioCodec: z.literal("aac").default("aac"),
  videoBitrateKbps: z.number().int().min(1200).max(16000).default(6500),
  audioBitrateKbps: z.number().int().min(96).max(320).default(160),
  watermark: z.boolean().default(false),
});

export const styleConfigSchema = z.object({
  schemaVersion: z.literal(1),
  layout: layoutConfigSchema,
  subtitles: subtitleConfigSchema,
  silence: silenceConfigSchema,
  title: timedLayerSchema.optional(),
  logo: timedLayerSchema.optional(),
  banner: timedLayerSchema.optional(),
  safeZones: z.array(z.enum(["shorts", "reels", "tiktok", "vk"])).default(["shorts", "reels", "tiktok", "vk"]),
  export: exportConfigSchema,
});

export const clipEdlSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  range: timeRangeSchema,
  cuts: z.array(timeRangeSchema).default([]),
  transcriptRevision: z.number().int().nonnegative().optional(),
  transcriptEdits: z.array(z.object({
    wordRef: z.string().min(1).max(160),
    displayText: z.string().max(240).optional(),
    hiddenFromSubtitles: z.boolean().default(false),
    cutFromMedia: z.boolean().default(false),
  })).max(2_000).default([]),
  layout: layoutConfigSchema,
  cropTrack: z.array(cropKeyframeSchema).optional(),
  faceTracks: z.array(faceTrackSchema).max(8).optional(),
  subtitles: subtitleConfigSchema,
  silence: silenceConfigSchema,
  title: timedLayerSchema.optional(),
  logo: timedLayerSchema.optional(),
  banner: timedLayerSchema.optional(),
  export: exportConfigSchema,
  styleVersionId: z.string().uuid(),
  rendererVersion: z.string().min(1).max(64),
});

export type TimeRange = z.infer<typeof timeRangeSchema>;
export type LayoutConfig = z.infer<typeof layoutConfigSchema>;
export type SubtitleConfig = z.infer<typeof subtitleConfigSchema>;
export type StyleConfig = z.infer<typeof styleConfigSchema>;
export type ClipEDL = z.infer<typeof clipEdlSchema>;
