import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button, PageHead } from "../ui/kit";
import { isTauri, pickVideo, runTool, sysInfo } from "../lib/tauri";

export function Diagnostics({ onBack }: { onBack: () => void }) {
  const [log, setLog] = useState("");
  const [src, setSrc] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const v = useRef<HTMLVideoElement>(null);
  const add = (s: string) => setLog((l) => `${l}${new Date().toISOString().slice(11, 23)}  ${s}\n`);

  return (
    <div className="page">
      <PageHead title="Диагностика" sub="Проверки платформы. Нужны только для разработки.">
        <Button variant="ghost" icon="back" onClick={onBack}>Назад</Button>
      </PageHead>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Button onClick={async () => { add(`sys: ${JSON.stringify(await sysInfo())}`); add(`ua: ${navigator.userAgent}`); }}>Система</Button>
        <Button onClick={async () => {
          const f = await pickVideo(); if (!f) return;
          setPicked(f.path); add(`picked ${f.path}`);
          if (isTauri) setSrc(convertFileSrc(f.path));
        }}>Выбрать видео</Button>
        <Button onClick={async () => {
          const el = v.current; if (!el?.duration) return add("сначала выберите видео");
          for (const p of [0.1, 0.5, 0.9, 0.3]) {
            const t0 = performance.now();
            await new Promise<void>((r) => { el.onseeked = () => r(); el.currentTime = p * el.duration; });
            add(`seek ${(p * el.duration).toFixed(1)}s: ${(performance.now() - t0).toFixed(0)} мс`);
          }
        }}>Перемотка</Button>
        <Button onClick={async () => { try { add(`ffmpeg: ${JSON.stringify(await runTool("ffmpeg", ["-version"]))}`); } catch (e) { add(`ffmpeg: ${e}`); } }}>ffmpeg</Button>
        <Button onClick={async () => { if (!picked) return add("сначала выберите видео"); try { add(`ffprobe: ${JSON.stringify(await runTool("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "json", picked]))}`); } catch (e) { add(`ffprobe: ${e}`); } }}>ffprobe</Button>
      </div>
      <video ref={v} className="diag-video" src={src} controls muted onLoadedMetadata={(e) => add(`metadata ok ${e.currentTarget.videoWidth}x${e.currentTarget.videoHeight} ${e.currentTarget.duration.toFixed(1)}s`)} />
      <div className="diag">{log || "Лог пуст"}</div>
    </div>
  );
}
