export type ProjectStatus =
  | "draft"
  | "uploading"
  | "importing"
  | "probing"
  | "transcribing"
  | "finding_moments"
  | "review_required"
  | "rendering"
  | "ready"
  | "partially_ready"
  | "failed"
  | "archived";

export type Project = {
  id: string;
  title: string;
  source: "YouTube" | "Файл";
  duration: string;
  durationMinutes: number;
  status: ProjectStatus;
  clipsFound: number;
  clipsReady: number;
  style: string;
  updatedAt: string;
  accent: "sky" | "ink" | "soft";
};

export type MomentCandidate = {
  id: string;
  title: string;
  topic: string;
  start: string;
  end: string;
  duration: string;
  excerpt: string;
  reason: string;
  selected: boolean;
  speaker: string;
  score: number;
  warnings?: string[];
  layout?: ClipLayout;
};

export type ClipLayout =
  | "auto"
  | "active_speaker"
  | "solo"
  | "podcast"
  | "panel"
  | "screen_speaker"
  | "blur"
  | "static_crop"
  | "picture_in_picture";

export type SubtitlePreset =
  | "clean"
  | "bold"
  | "karaoke"
  | "active_word"
  | "word_pop"
  | "minimal_box"
  | "speaker_colors";

export type ClipEditorState = {
  title: string;
  socialTitle: string;
  socialDescription: string;
  startSeconds: number;
  endSeconds: number;
  layout: ClipLayout;
  speaker: string;
  captionsEnabled: boolean;
  subtitlePreset: SubtitlePreset;
  fontFamily: string;
  fontSize: number;
  subtitlePosition: "top" | "center" | "bottom";
  primaryColor: string;
  activeColor: string;
  titleEnabled: boolean;
  titlePosition: "top" | "center" | "bottom";
  bannerEnabled: boolean;
  logoEnabled: boolean;
  silenceRemoval: boolean;
  normalizeAudio: boolean;
  exportHeight: 1280 | 1920;
};

export type ClipResult = {
  id: string;
  momentId: string;
  title: string;
  topic: string;
  duration: string;
  status: "queued" | "rendering" | "ready" | "failed";
  version: number;
};

export type SourceLibraryItem = {
  id: string;
  title: string;
  source: "YouTube" | "Файл";
  duration: string;
  lastUsed: string;
  retainedUntil: string;
};

export type StylePreset = {
  id: string;
  name: string;
  description: string;
  isDefault?: boolean;
  captions: string;
  subtitlePreset: SubtitlePreset;
  fontFamily: string;
  subtitlePosition: "top" | "center" | "bottom";
  framing: string;
  /** Full immutable API layout; `framing` is only its dashboard label. */
  layoutConfig?: StyleConfig["layout"];
  silenceRemoval: boolean;
  title: boolean;
  logo: boolean;
  banner: boolean;
  safeZones: Array<"shorts" | "reels" | "tiktok" | "vk">;
  colors: [string, string];
  version?: number;
  versionId?: string;
  persisted?: boolean;
  dirty?: boolean;
};

export type MinuteTransaction = {
  id: string;
  title: string;
  date: string;
  amount: number;
  kind: "charge" | "refund" | "credit";
};

export type AppAnalyticsEvent =
  | "dashboard_view"
  | "project_create_start"
  | "source_url_submit"
  | "source_upload_start"
  | "source_upload_complete"
  | "source_probe_complete"
  | "project_settings_complete"
  | "analysis_start"
  | "analysis_complete"
  | "analysis_failed"
  | "moment_select"
  | "moment_boundaries_apply"
  | "moments_recompute"
  | "transcript_edit"
  | "render_start"
  | "clip_render_complete"
  | "clip_render_failed"
  | "clip_rerender"
  | "clip_download"
  | "project_download_all"
  | "style_create"
  | "style_apply"
  | "clip_editor_open"
  | "clip_version_save"
  | "clip_scope_apply"
  | "source_reuse"
  | "generative_quote_view"
  | "minutes_insufficient"
  | "minutes_package_select"
  | "minutes_purchase_start"
  | "minutes_purchase_complete";
import type { StyleConfig } from "@/packages/contracts/src/media";
