export type ProjectStatus =
  | "draft"
  | "uploading"
  | "transcribing"
  | "finding_moments"
  | "review_required"
  | "rendering"
  | "ready"
  | "partially_ready"
  | "failed";

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
};

export type StylePreset = {
  id: string;
  name: string;
  description: string;
  isDefault?: boolean;
  captions: string;
  framing: string;
  silenceRemoval: boolean;
  banner: boolean;
  colors: [string, string];
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
  | "minutes_insufficient"
  | "minutes_package_select"
  | "minutes_purchase_complete";

