import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Native file picker in the app; in a plain browser (dev preview) returns a demo file. */
export async function pickVideo(): Promise<{ path: string; name: string } | null> {
  if (!isTauri) return { path: "/demo/Интервью с основателем.mp4", name: "Интервью с основателем.mp4" };
  const f = await open({ multiple: false, filters: [{ name: "Видео", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }] });
  if (!f || Array.isArray(f)) return null;
  return { path: f, name: f.split(/[\\/]/).pop() ?? f };
}

export async function runTool(program: "ffmpeg" | "ffprobe", args: string[]) {
  if (!isTauri) throw new Error("доступно только в приложении");
  return invoke("run_tool", { program, args });
}

export async function sysInfo() {
  if (!isTauri) return { os: "browser-preview", arch: "-", cpus: navigator.hardwareConcurrency };
  return invoke("sys_info");
}
