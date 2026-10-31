import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type EngineStatus = {
  os: string;
  arch: string;
  cpus: number;
  ramBytes: number;
  tools: Record<string, boolean>;
  model: { id: string; installed: boolean; bytes: number; sha256: string | null };
};

export type MediaInfo = {
  path: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number;
};

export type Word = { startMs: number; endMs: number; text: string };
export type Segment = { startMs: number; endMs: number; text: string; words: Word[] };
export type Transcript = { language: string; durationMs: number; model: string; elapsedMs: number; segments: Segment[] };
export type Progress = { jobId: string; stage: "download" | "model" | "audio" | "transcribe"; percent: number | null; message: string | null };

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const newJobId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const engine = {
  status: () => invoke<EngineStatus>("engine_status"),
  installModel: (jobId: string) => invoke<EngineStatus["model"]>("model_install", { jobId }),
  probe: (path: string) => invoke<MediaInfo>("media_probe", { path }),
  download: (jobId: string, url: string) => invoke<{ path: string }>("media_download", { jobId, url }),
  transcribe: (jobId: string, path: string, language = "ru") =>
    invoke<Transcript>("media_transcribe", { jobId, path, language }),
  cancel: (jobId: string) => invoke<boolean>("job_cancel", { jobId }),
  onProgress: (handler: (p: Progress) => void): Promise<UnlistenFn> =>
    listen<Progress>("engine:progress", (event) => handler(event.payload)),
};
