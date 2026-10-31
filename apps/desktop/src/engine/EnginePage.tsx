import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { engine, inTauri, newJobId, type EngineStatus, type MediaInfo, type Progress, type Transcript } from "./engine";

const STAGE: Record<string, string> = {
  download: "Скачивание видео",
  model: "Загрузка речевой модели",
  audio: "Подготовка звука",
  transcribe: "Расшифровка речи",
};
const mb = (n: number) => `${Math.round(n / 1_000_000)} МБ`;
const ts = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Self-test for the local engine: shows what is installed and runs the real pipeline on a chosen file or link. */
export function EnginePage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [url, setUrl] = useState("");
  const job = useRef<string | null>(null);

  const refresh = useCallback(() => engine.status().then(setStatus).catch((e) => setError(String(e))), []);

  useEffect(() => {
    if (!inTauri()) return;
    void refresh();
    const unlisten = engine.onProgress((p) => p.jobId === job.current && setProgress(p));
    return () => void unlisten.then((fn) => fn());
  }, [refresh]);

  const run = async (work: (jobId: string) => Promise<void>) => {
    const jobId = newJobId();
    job.current = jobId;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await work(jobId);
    } catch (e) {
      if (String(e) !== "cancelled") setError(String(e));
    } finally {
      setBusy(false);
      job.current = null;
      void refresh();
    }
  };

  const transcribe = (path: string) =>
    run(async (jobId) => {
      setTranscript(null);
      setMedia(await engine.probe(path));
      setTranscript(await engine.transcribe(jobId, path));
    });

  const pickFile = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Видео и аудио", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mp3", "wav", "m4a"] }] });
    if (typeof path === "string") await transcribe(path);
  };

  const fromLink = () =>
    run(async (jobId) => {
      setTranscript(null);
      const { path } = await engine.download(jobId, url.trim());
      setMedia(await engine.probe(path));
      const second = newJobId();
      job.current = second;
      setTranscript(await engine.transcribe(second, path));
    });

  if (!inTauri()) {
    return <div className="hp-content"><p className="text-sm text-muted-foreground">Движок доступен только в установленном приложении.</p></div>;
  }

  const tools = status ? Object.entries(status.tools) : [];
  return (
    <div className="hp-content" style={{ maxWidth: 880 }}>
      <h1 className="text-2xl font-semibold">Локальный движок</h1>
      <p className="mt-1 text-sm text-muted-foreground">Видео и звук не покидают компьютер. Наружу уходит только текст расшифровки.</p>

      <section className="mt-6 rounded-xl border border-border p-4">
        {status ? (
          <>
            <div className="text-sm text-muted-foreground">
              {status.os} / {status.arch} · {status.cpus} потоков · {(status.ramBytes / 1024 ** 3).toFixed(0)} ГБ ОЗУ
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tools.map(([name, ok]) => (
                <span key={name} className="rounded-md px-2 py-1 text-xs" style={{ background: ok ? "#14351f" : "#3d1616", color: ok ? "#7ee2a0" : "#ff9b9b" }}>
                  {name}: {ok ? "есть" : "нет"}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span>Модель {status.model.id}: {status.model.installed ? `установлена (${mb(status.model.bytes)})` : "не установлена"}</span>
              {!status.model.installed && (
                <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy} onClick={() => run((id) => engine.installModel(id).then(() => undefined))}>
                  Скачать модель
                </button>
              )}
            </div>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Проверяю компоненты…</span>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy || !status?.model.installed} onClick={pickFile}>
            Выбрать файл и расшифровать
          </button>
          <input className="min-w-[260px] flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm" placeholder="или вставьте ссылку на видео" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={busy || !url.trim() || !status?.model.installed} onClick={fromLink}>
            Скачать и расшифровать
          </button>
          {busy && job.current && (
            <button className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => job.current && void engine.cancel(job.current)}>
              Отмена
            </button>
          )}
        </div>
        {busy && (
          <div className="mt-4">
            <div className="text-sm">{progress ? `${STAGE[progress.stage] ?? progress.stage}${progress.message ? ` · ${progress.message}` : ""}` : "Запуск…"}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "#27272a" }}>
              <div className="h-full rounded-full" style={{ width: `${progress?.percent ?? 2}%`, background: "var(--brand-orange, #f59e0b)", transition: "width 200ms" }} />
            </div>
          </div>
        )}
        {error && <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: "#3d1616", color: "#ff9b9b" }}>{error}</div>}
      </section>

      {media && (
        <section className="mt-4 rounded-xl border border-border p-4 text-sm">
          Файл: {ts(media.durationMs)} · {media.width ?? "?"}×{media.height ?? "?"} · {media.fps ? `${media.fps.toFixed(0)} к/с` : ""} · {mb(media.sizeBytes)}
        </section>
      )}
      {transcript && (
        <section className="mt-4 rounded-xl border border-border p-4">
          <div className="text-sm text-muted-foreground">
            {transcript.segments.length} фраз · язык {transcript.language} · {transcript.model} · заняло {(transcript.elapsedMs / 1000).toFixed(0)} с на {ts(transcript.durationMs)} записи
          </div>
          <ol className="mt-3 space-y-1 text-sm">
            {transcript.segments.slice(0, 40).map((s) => (
              <li key={s.startMs}><span className="text-muted-foreground">{ts(s.startMs)}</span> {s.text}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
