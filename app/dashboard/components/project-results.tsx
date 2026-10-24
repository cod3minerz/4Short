"use client";

import {
  Button,
  Card,
  Modal,
  SearchField,
} from "@heroui/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Download02Icon,
  FileVideoIcon,
  Clock01Icon,
  GridViewIcon,
  ListViewIcon,
  PlayIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import Image from "next/image";
import { ProjectWorkspace } from "./project-workspace";
import { isProjectJobQueued } from "../lib/project-status";
import {
  ControlApiError,
  getClipArtifact,
  getClipPlayback,
  createProjectPackage,
  getProject,
  getProjectExecutionEstimate,
  getProjectPackage,
  getTranscript,
  rerenderClip,
  type ApiClip,
  type ApiMoment,
} from "../lib/control-api";

type ProjectPayload = Awaited<ReturnType<typeof getProject>>;
type TranscriptLine = { startMs: number; endMs: number; text: string };
type View = "grid" | "list";
type ClipFilter = "all" | "ready" | "processing" | "failed" | "unavailable";

const activeStatuses = new Set(["draft", "uploading", "importing", "probing", "transcribing", "finding_moments", "rendering"]);

function faceTrackingNotice(warnings: string[]) {
  if (warnings.includes("FACE_NOT_FOUND")) return "Лицо не обнаружено — для этого клипа применено кадрирование по центру.";
  if (warnings.includes("ACTIVE_SPEAKER_MODEL_PENDING")) return "В кадре несколько лиц. Пока кадрирование следует за основным лицом, а не за активным говорящим.";
  return "Динамическое кадрирование недоступно — для этого клипа применено кадрирование по центру.";
}

export function ProjectResults({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const selectedClipId = searchParams.get("clip");
  const query = searchParams.get("q") ?? "";
  const view: View = searchParams.get("view") === "list" ? "list" : "grid";
  const requestedFilter = searchParams.get("status");
  const clipFilter: ClipFilter = requestedFilter === "ready" || requestedFilter === "processing" || requestedFilter === "failed" || requestedFilter === "unavailable" ? requestedFilter : "all";
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playback, setPlayback] = useState<{ clipId: string; url?: string; error?: string } | null>(null);
  const [transcriptResult, setTranscriptResult] = useState<{ clipId: string; lines: TranscriptLine[] } | null>(null);
  const [downloadKind, setDownloadKind] = useState<"mp4" | "srt" | "vtt" | null>(null);
  const [actionError, setActionError] = useState("");
  const [packageJob, setPackageJob] = useState<{ id: string; status: string; error?: string } | null>(null);
  const [packagePending, setPackagePending] = useState(false);
  const [rerenderPending, setRerenderPending] = useState(false);
  const [executionEstimateState, setExecutionEstimateState] = useState<{ projectId: string; value: Awaited<ReturnType<typeof getProjectExecutionEstimate>> } | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const packageJobId = packageJob?.id;
  const packageStatus = packageJob?.status;
  const openedFromPage = useRef(false);

  const load = useCallback(async (quiet = false) => {
    try {
      const next = await getProject(projectId);
      setData(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof ControlApiError ? caught.message : "Не удалось загрузить проект. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  useEffect(() => {
    if (!data || !activeStatuses.has(data.project.status)) return;
    const timer = window.setInterval(() => { void load(true); }, 3_000);
    return () => window.clearInterval(timer);
  }, [data, load]);

  const processingStatus = data?.project.status;
  useEffect(() => {
    if (!processingStatus || !activeStatuses.has(processingStatus)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const estimate = await getProjectExecutionEstimate(projectId);
        if (!cancelled) setExecutionEstimateState({ projectId, value: estimate });
      } catch {
        if (!cancelled) setExecutionEstimateState(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, processingStatus]);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!packageJobId || !packageStatus || !["queued", "processing"].includes(packageStatus)) return;
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const response = await getProjectPackage(projectId, packageJobId);
        if (cancelled) return;
        const next = response.package;
        setPackageJob({ id: next.id, status: next.status, error: next.error?.message });
        if (["queued", "processing"].includes(next.status)) timer = window.setTimeout(refresh, 2_000);
      } catch {
        if (!cancelled) timer = window.setTimeout(refresh, 4_000);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, packageJobId, packageStatus]);

  const selectedClip = useMemo(
    () => data?.clips.find((clip) => clip.id === selectedClipId) ?? null,
    [data, selectedClipId],
  );
  useEffect(() => {
    if (!selectedClipId) openedFromPage.current = false;
  }, [selectedClipId]);
  const playbackUrl = selectedClip && playback?.clipId === selectedClip.id ? playback.url ?? "" : "";
  const playbackError = selectedClip && playback?.clipId === selectedClip.id ? playback.error ?? "" : "";
  const transcript = selectedClip && transcriptResult?.clipId === selectedClip.id ? transcriptResult.lines : [];
  const selectedMoment = useMemo(
    () => data?.moments.find((moment) => moment.id === selectedClip?.momentCandidateId) ?? null,
    [data, selectedClip],
  );
  const filteredClips = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    const clips = data?.clips ?? [];
    return clips.filter((clip) => {
      const matchesQuery = !normalized || clip.title.toLocaleLowerCase("ru-RU").includes(normalized);
      const matchesFilter = clipFilter === "all"
        || (clipFilter === "ready" && clip.status === "ready" && clip.playbackAvailable !== false)
        || (clipFilter === "processing" && (clip.status === "queued" || clip.status === "rendering"))
        || (clipFilter === "failed" && clip.status === "failed")
        || (clipFilter === "unavailable" && clip.status === "ready" && clip.playbackAvailable === false);
      return matchesQuery && matchesFilter;
    });
  }, [data, query, clipFilter]);
  const readyCount = data?.clips.filter((clip) => clip.status === "ready" && clip.playbackAvailable !== false).length ?? 0;
  const unavailableCount = data?.clips.filter((clip) => clip.status === "ready" && clip.playbackAvailable === false).length ?? 0;
  const activeCount = data?.clips.filter((clip) => clip.status === "queued" || clip.status === "rendering").length ?? 0;
  const failedCount = data?.clips.filter((clip) => clip.status === "failed").length ?? 0;
  const packageReady = packageJob?.status === "ready";

  async function requestPackage() {
    setPackagePending(true);
    setActionError("");
    try {
      const result = await createProjectPackage(projectId);
      setPackageJob({ id: result.package.id, status: result.package.status });
    } catch (caught) {
      setActionError(caught instanceof ControlApiError ? caught.message : "Не удалось подготовить архив. Попробуйте ещё раз.");
    } finally {
      setPackagePending(false);
    }
  }

  async function downloadPackage() {
    if (!packageJob) return;
    try {
      const result = await getProjectPackage(projectId, packageJob.id);
      if (!result.download?.url) throw new Error("ARCHIVE_NOT_READY");
      const anchor = document.createElement("a");
      anchor.href = result.download.url;
      anchor.download = "narezai-clips.zip";
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (caught) {
      setActionError(caught instanceof ControlApiError ? caught.message : "Архив пока недоступен. Обновите состояние и попробуйте ещё раз.");
    }
  }

  async function restoreClip() {
    if (!selectedClip || !data?.source?.mediaAvailable || rerenderPending) return;
    setRerenderPending(true);
    setActionError("");
    try {
      await rerenderClip(projectId, selectedClip.id);
      await load(true);
    } catch (caught) {
      setActionError(caught instanceof ControlApiError ? caught.message : "Не удалось восстановить видео. Попробуйте ещё раз.");
    } finally {
      setRerenderPending(false);
    }
  }

  useEffect(() => {
    if (!selectedClip || selectedClip.status !== "ready") return;
    let cancelled = false;
    void getClipPlayback(projectId, selectedClip.id).then(
      (playback) => { if (!cancelled) setPlayback({ clipId: selectedClip.id, url: playback.url }); },
      (caught: unknown) => {
        if (!cancelled) setPlayback({ clipId: selectedClip.id, error: caught instanceof ControlApiError && caught.status === 404
          ? "Файл клипа пока недоступен. Обновите экран через несколько секунд."
          : "Не удалось открыть видео. Проверьте соединение и попробуйте ещё раз." });
      },
    );
    return () => { cancelled = true; };
  }, [projectId, selectedClip]);

  useEffect(() => {
    if (!selectedClip || !selectedMoment || selectedClip.status !== "ready") return;
    let cancelled = false;
    void getTranscript(projectId).then((response) => {
      if (cancelled) return;
      setTranscriptResult({ clipId: selectedClip.id, lines: response.segments
        .filter((line) => line.endMs >= selectedMoment.startMs && line.startMs <= selectedMoment.endMs)
        .map((line) => ({ startMs: line.startMs, endMs: line.endMs, text: line.originalText })) });
    }).catch(() => { if (!cancelled) setTranscriptResult({ clipId: selectedClip.id, lines: [] }); });
    return () => { cancelled = true; };
  }, [projectId, selectedClip, selectedMoment]);

  function updateUrl(updates: Record<string, string | null>, mode: "push" | "replace" = "replace") {
    const next = new URLSearchParams(queryString);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const url = `${pathname}${next.size ? `?${next.toString()}` : ""}`;
    if (mode === "push") router.push(url, { scroll: false });
    else router.replace(url, { scroll: false });
  }

  function openClip(clipId: string) {
    openedFromPage.current = true;
    updateUrl({ clip: clipId }, "push");
  }

  function closeClip() {
    if (openedFromPage.current) {
      openedFromPage.current = false;
      router.back();
    } else {
      updateUrl({ clip: null });
    }
  }

  async function download(kind: "mp4" | "srt" | "vtt") {
    if (!selectedClip) return;
    setDownloadKind(kind);
    setActionError("");
    try {
      const artifact = await getClipArtifact(projectId, selectedClip.id, kind);
      const anchor = document.createElement("a");
      anchor.href = artifact.url;
      anchor.download = `${safeFilename(selectedClip.title)}.${kind}`;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (caught) {
      setActionError(caught instanceof ControlApiError ? caught.message : "Не удалось подготовить скачивание. Попробуйте ещё раз.");
    } finally {
      setDownloadKind(null);
    }
  }

  if (data?.project.status === "review_required") return <ProjectWorkspace projectId={projectId} />;

  if (loading && !data) return <main className="hp-results" aria-busy="true"><div className="hp-results__loading" role="status">Загружаем клипы…</div></main>;
  if (error && !data) return <main className="hp-results"><div className="hp-results__error" role="alert"><span>{error}</span><Button variant="secondary" onPress={() => { setLoading(true); void load(); }}>Повторить</Button></div></main>;
  if (!data) return null;

  const projectStage = projectStateLabel(data.project.status, data.processing?.status);
  const projectProgress = measuredPercent(data.processing?.progress);
  const isProcessing = activeStatuses.has(data.project.status);
  const processingStep = processingStepIndex(data.project.status, data.processing?.type);
  const elapsedSeconds = data.processing?.startedAt && nowMs
    ? Math.max(0, Math.floor((nowMs - new Date(data.processing.startedAt).getTime()) / 1000))
    : null;
  const executionEstimate = executionEstimateState?.projectId === projectId ? executionEstimateState.value : null;
  const executionRange = isProcessing && executionEstimate?.status === "estimated"
    && executionEstimate.executionP10Seconds !== null
    && executionEstimate.executionP90Seconds !== null
    ? `${formatElapsed(executionEstimate.executionP10Seconds)}–${formatElapsed(executionEstimate.executionP90Seconds)}`
    : null;

  return (
    <main className="hp-results" aria-labelledby="hp-results-title">
      <nav className="hp-results__breadcrumbs" aria-label="Навигационная цепочка">
        <Link href="/dashboard/projects"><AppIcon icon={ArrowLeft01Icon} size="sm" aria-hidden="true" />Мои проекты</Link>
        <span aria-hidden="true">/</span><span>{data.project.title}</span>
      </nav>

      <header className="hp-results__header">
        <div className="hp-results__title-group">
          <h1 id="hp-results-title">{data.project.title}</h1>
          <p>{data.clips.length} {pluralize(data.clips.length, "клип", "клипа", "клипов")}
            {readyCount ? ` · ${readyCount} доступно` : ""}
            {unavailableCount ? ` · ${unavailableCount} файл недоступен` : ""}
            {activeCount ? ` · ${activeCount} в обработке` : ""}
            {failedCount ? ` · ${failedCount} с ошибкой` : ""}</p>
        </div>
        <div className="hp-results__header-actions">
          <span className={`hp-results__state ${isProcessing ? "is-active" : data.project.status === "failed" ? "is-failed" : ""}`}>
            {isProcessing ? <span aria-hidden="true" className="hp-results__state-dot" /> : null}{projectStage}
          </span>
          {projectProgress !== null ? <span className="hp-results__measured-progress">{projectProgress}%</span> : null}
        </div>
      </header>

      {isProcessing ? <section className="hp-results__processing" aria-label="Состояние обработки">
        <div className="hp-results__processing-mark" aria-hidden="true"><AppIcon icon={FileVideoIcon} size="md" /></div>
        <div className="hp-results__processing-main">
          <div className="hp-results__processing-heading"><strong>{projectStage}</strong><span className="hp-results__processing-kicker">Этап {processingStep + 1} из 4</span></div>
          <p className="hp-results__processing-description">{data.processing?.type ? processingDescription(data.processing.type) : "Проект обрабатывается на сервере. Состояние обновляется автоматически."}</p>
        </div>
        <div className="hp-results__processing-steps" aria-label="Этапы обработки">
          {["Источник", "Распознавание речи", "Поиск фрагментов", "Создание клипов"].map((label, index) => <span key={label} className={`hp-results__processing-step${index < processingStep ? " is-complete" : index === processingStep ? " is-current" : ""}`} aria-current={index === processingStep ? "step" : undefined}>{label}</span>)}
        </div>
        <div className="hp-results__processing-footer">
          {data.processing?.status === "queued" || data.processing?.status === "waiting_provider" ? <span className="hp-results__processing-stat">Задача ожидает свободного обработчика</span> : null}
          {elapsedSeconds !== null ? <span className="hp-results__processing-stat"><AppIcon icon={Clock01Icon} size="sm" aria-hidden="true" />На этапе <strong>{formatElapsed(elapsedSeconds)}</strong></span> : null}
          {executionRange ? <span className="hp-results__processing-stat">Оценка выполнения <strong>{executionRange}</strong><span className="hp-results__processing-note">без учёта очереди</span></span> : null}
          {!executionRange ? <span className="hp-results__processing-stat">Точного прогноза пока нет</span> : null}
          <div className="hp-results__processing-progress">
            <div className={`hp-results__progress${projectProgress === null ? " is-indeterminate" : ""}`} role="progressbar" aria-label={projectProgress === null ? "Обработка продолжается" : "Прогресс текущего этапа"} aria-valuemin={0} aria-valuemax={100} {...(projectProgress === null ? {} : { "aria-valuenow": projectProgress })}><span style={projectProgress === null ? undefined : { width: `${projectProgress}%` }} /></div>
            <strong>{projectProgress === null ? "Идёт работа" : `${projectProgress}%`}</strong>
          </div>
        </div>
      </section> : null}
      {data.project.status === "failed" ? <div className="hp-results__project-error" role="alert">{data.project.errorMessage ?? "Не удалось обработать видео."}</div> : null}
      {error ? <p className="hp-results__refresh-note" role="status">Не удалось обновить состояние. Показываем последние загруженные данные.</p> : null}

      <section className="hp-results__toolbar" aria-label="Поиск и отображение клипов">
        <SearchField aria-label="Найти клип" className="hp-results__search" value={query} onChange={(value) => updateUrl({ q: value })}>
          <SearchField.Group>
            <SearchField.SearchIcon><AppIcon icon={Search01Icon} size="sm" aria-hidden="true" /></SearchField.SearchIcon>
            <SearchField.Input placeholder="Найти клип по названию" />
            <SearchField.ClearButton aria-label="Очистить поиск" />
          </SearchField.Group>
        </SearchField>
        <div className="hp-results__toolbar-actions">
          {readyCount > 0 ? <Button variant={packageReady ? "secondary" : "tertiary"} size="sm" isPending={packagePending || packageJob?.status === "queued" || packageJob?.status === "processing"} onPress={() => packageReady ? void downloadPackage() : void requestPackage()}>
            {packageReady ? "Скачать ZIP" : packageJob?.status === "failed" ? "Повторить архив" : `Скачать готовые · ${readyCount}`}
          </Button> : null}
          <div className="hp-results__view" role="group" aria-label="Вид клипов">
            <Button className="hp-results__view-button" aria-label="Сетка" aria-pressed={view === "grid"} variant={view === "grid" ? "secondary" : "tertiary"} isIconOnly onPress={() => updateUrl({ view: null })}><AppIcon icon={GridViewIcon} size="sm" aria-hidden="true" /></Button>
            <Button className="hp-results__view-button" aria-label="Список" aria-pressed={view === "list"} variant={view === "list" ? "secondary" : "tertiary"} isIconOnly onPress={() => updateUrl({ view: "list" })}><AppIcon icon={ListViewIcon} size="sm" aria-hidden="true" /></Button>
          </div>
        </div>
      </section>

      {actionError ? <p className="hp-results__action-error hp-results__toolbar-error" role="alert">{actionError}</p> : null}
      {packageJob && ["queued", "processing"].includes(packageJob.status) ? <p className="hp-results__package-status" role="status">Готовим архив из {readyCount} {pluralize(readyCount, "клипа", "клипов", "клипов")}…</p> : null}

      {data.clips.length > 0 ? <nav className="hp-results__filters" aria-label="Фильтр клипов">
        {([
          ["all", "Все", data.clips.length],
          ["ready", "Доступны", readyCount],
          ["processing", "В обработке", activeCount],
          ["failed", "С ошибкой", failedCount],
          ["unavailable", "Файл недоступен", unavailableCount],
        ] as const).filter(([filter, , count]) => count > 0 || clipFilter === "all" || clipFilter === filter).map(([filter, label, count]) => (
          <Button key={filter} className="hp-results__filter" variant="tertiary" aria-current={clipFilter === filter ? "page" : undefined} onPress={() => updateUrl({ status: filter === "all" ? null : filter })}>
            {label}<span>{count}</span>
          </Button>
        ))}
      </nav> : null}

      {data.clips.length === 0 ? <section className="hp-results__empty">
        {isProcessing ? <><span className="hp-results__empty-icon"><AppIcon icon={FileVideoIcon} size="md" aria-hidden="true" /></span><h2>Клипы появятся после обработки</h2><p>Можно закрыть страницу — проект продолжит обрабатываться.</p></>
          : data.project.status === "failed" ? <><h2>Клипы не созданы</h2><p>Откройте проект позже или попробуйте повторить обработку, если действие доступно.</p></>
            : <><h2>В этом проекте пока нет клипов</h2><p>Когда появятся результаты, их можно будет открыть и скачать здесь.</p></>}
      </section> : filteredClips.length === 0 ? <section className="hp-results__empty"><h2>{clipFilter === "all" ? "Клипы не найдены" : "В этой группе пока нет клипов"}</h2><p>{clipFilter === "all" ? "Попробуйте изменить поисковый запрос." : "Выберите другую группу или покажите все клипы."}</p><Button variant="tertiary" onPress={() => updateUrl({ q: null, status: null })}>Показать все клипы</Button></section> : (
        <section className={`hp-results__clips ${view === "list" ? "is-list" : "is-grid"}`} aria-label="Клипы проекта">
          {filteredClips.map((clip) => <ClipCard key={clip.id} clip={clip} moment={data.moments.find((moment) => moment.id === clip.momentCandidateId) ?? null} view={view} onOpen={() => openClip(clip.id)} />)}
        </section>
      )}

      <Modal isOpen={Boolean(selectedClip)} onOpenChange={(open) => { if (!open && selectedClip) closeClip(); }}>
        <Button className="hp-results__modal-anchor" aria-hidden="true" isDisabled />
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="hp-results__clip-dialog" aria-labelledby="hp-clip-title">
              <Modal.Header>
                <div className="hp-results__modal-heading">
                  <Modal.Heading id="hp-clip-title">{selectedClip?.title ?? "Клип"}</Modal.Heading>
                  {selectedMoment ? <span>{formatClock(selectedMoment.startMs)}–{formatClock(selectedMoment.endMs)}</span> : null}
                </div>
                <Modal.CloseTrigger aria-label="Закрыть клип"><AppIcon icon={Cancel01Icon} size="sm" aria-hidden="true" /></Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body>
                {selectedClip?.status === "ready" && selectedClip.playbackAvailable !== false ? <div className="hp-results__clip-detail">
                  <div className="hp-results__player-wrap">
                    {playbackUrl ? <video className="hp-results__player" controls autoPlay playsInline src={playbackUrl} /> : <div className="hp-results__player-state" role="status"><AppIcon icon={PlayIcon} size="lg" aria-hidden="true" /><span>{playbackError || "Открываем видео…"}</span></div>}
                  </div>
                  <aside className="hp-results__clip-info">
                    <div><span className="hp-results__eyebrow">Фрагмент транскрипта</span>
                      {transcript.length ? <div className="hp-results__transcript">{transcript.map((line, index) => <p key={`${line.startMs}-${index}`}><time>{formatClock(line.startMs)}</time><span>{line.text}</span></p>)}</div>
                        : <p className="hp-results__muted">Текст для этого фрагмента недоступен.</p>}
                    </div>
                    {selectedMoment?.explanation ? <p className="hp-results__reason">{selectedMoment.explanation}</p> : null}
                    {selectedClip.faceTrackingWarnings?.length ? <p className="hp-results__muted" role="status">{faceTrackingNotice(selectedClip.faceTrackingWarnings)}</p> : null}
                    <div className="hp-results__downloads" aria-label="Скачать клип">
                      {(["mp4", "srt", "vtt"] as const).map((kind) => <Button key={kind} size="sm" variant={kind === "mp4" ? "secondary" : "tertiary"} isPending={downloadKind === kind} isDisabled={Boolean(downloadKind)} onPress={() => void download(kind)}>
                        {kind === "mp4" ? <AppIcon icon={Download02Icon} size="sm" aria-hidden="true" /> : null}{kind.toUpperCase()}
                      </Button>)}
                    </div>
                    {actionError ? <p className="hp-results__action-error" role="alert">{actionError}</p> : null}
                    <Button className="hp-results__editor-link" variant="primary" onPress={() => router.push(`/dashboard/projects/${projectId}/clips/${selectedClip.id}`)}>
                      Открыть редактор
                    </Button>
                  </aside>
                </div> : selectedClip?.status === "ready" ? <div className="hp-results__pending-detail">
                  <span className="hp-results__empty-icon"><AppIcon icon={FileVideoIcon} size="md" aria-hidden="true" /></span>
                  <h2>Файл клипа недоступен</h2>
                  <p>{data.source?.mediaAvailable
                    ? "Исходное видео ещё доступно — можно заново собрать клип с сохранёнными настройками."
                    : data.source?.expiresAt
                      ? `Исходное видео больше недоступно. Срок хранения завершился ${formatRetentionDate(data.source.expiresAt)}.`
                      : "Исходное видео недоступно, поэтому восстановить клип автоматически не получится."}</p>
                  {data.source?.mediaAvailable ? <Button variant="secondary" isPending={rerenderPending} onPress={() => void restoreClip()}>
                    {rerenderPending ? "Запускаем рендер…" : "Повторить рендер"}
                  </Button> : null}
                  {actionError ? <p className="hp-results__action-error" role="alert">{actionError}</p> : null}
                </div> : <div className="hp-results__pending-detail"><span className="hp-results__empty-icon"><AppIcon icon={FileVideoIcon} size="md" aria-hidden="true" /></span><h2>{clipStateLabel(selectedClip?.status ?? "queued")}</h2><p>Скачивание и предпросмотр появятся, когда рендер завершится.</p></div>}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </main>
  );
}

function ClipCard({ clip, moment, view, onOpen }: { clip: ApiClip; moment: ApiMoment | null; view: View; onOpen: () => void }) {
  const ready = clip.status === "ready";
  const mediaUnavailable = ready && clip.playbackAvailable === false;
  const [posterUnavailable, setPosterUnavailable] = useState(false);
  return <Card className={`hp-results__clip-card ${view === "list" ? "is-list" : ""}`} variant="transparent">
    <Button className="hp-results__clip-open" variant="ghost" onPress={onOpen} aria-label={`${clip.title}. ${mediaUnavailable ? "Файл недоступен" : clipStateLabel(clip.status)}. ${ready ? "Открыть клип" : "Посмотреть состояние"}`}>
      <span className="hp-results__clip-preview">
        {clip.posterUrl && !posterUnavailable ? <Image className="hp-results__poster" src={clip.posterUrl} alt="" width={640} height={640} unoptimized sizes="(max-width: 800px) 45vw, 280px" onError={() => setPosterUnavailable(true)} /> : <span className="hp-results__poster-missing"><AppIcon icon={FileVideoIcon} size="md" aria-hidden="true" />{view === "grid" ? <span>{ready ? "Нет кадра предпросмотра" : "Кадр появится после рендера"}</span> : null}</span>}
        {ready ? <span className="hp-results__play"><AppIcon icon={PlayIcon} size="sm" aria-hidden="true" /></span> : null}
        <span className={`hp-results__clip-state ${mediaUnavailable || clip.status === "failed" ? "is-failed" : ready ? "is-ready" : "is-pending"}`}>{mediaUnavailable ? "Файл недоступен" : clipStateLabel(clip.status)}</span>
        {moment ? <time className="hp-results__clip-time">{formatClock(moment.startMs)}–{formatClock(moment.endMs)}</time> : null}
      </span>
      <span className="hp-results__clip-copy">
        <strong>{clip.title}</strong>
        <span>{moment?.explanation || (mediaUnavailable ? "Рендер завершён, но видео больше недоступно" : ready ? "Видео готово к просмотру" : "Предпросмотр появится после рендера")}</span>
        {clip.playbackAvailable && clip.playbackExpiresAt ? <span className="hp-results__clip-retention">Видео доступно до {formatRetentionDate(clip.playbackExpiresAt)}</span> : null}
      </span>
    </Button>
  </Card>;
}

function projectStateLabel(status: string, jobStatus?: string) {
  if (status === "ready") return "Готово";
  if (status === "partially_ready") return "Часть клипов готова";
  if (status === "failed") return "Ошибка обработки";
  if (status === "review_required") return "Нужна проверка";
  if (isProjectJobQueued(status, jobStatus)) return "В очереди";
  if (status === "rendering") return "Создаём клипы";
  if (status === "finding_moments") return "Ищем фрагменты";
  if (status === "transcribing") return "Распознаём речь";
  if (status === "probing" || status === "importing" || status === "uploading") return "Готовим видео";
  return "Подготовка проекта";
}

function processingDescription(type: string) {
  if (type === "clip_render") return "Видео собирается с выбранными настройками.";
  if (type === "find_moments") return "Анализируем содержание и подбираем самостоятельные фрагменты.";
  if (type === "transcribe") return "Распознаём речь и формируем транскрипт.";
  return "Проект продолжает обрабатываться на сервере.";
}

function measuredPercent(progress: { completed?: number; total?: number; unit?: "bytes" | "milliseconds" | "frames" | "steps" } | null | undefined) {
  if (!progress || typeof progress.completed !== "number" || typeof progress.total !== "number" || progress.total <= 0) return null;
  return Math.round(Math.max(0, Math.min(progress.completed, progress.total)) / progress.total * 100);
}

function processingStepIndex(status: string, type?: string) {
  if (status === "rendering" || type === "clip_render") return 3;
  if (status === "finding_moments") return 2;
  if (status === "transcribing") return 1;
  return 0;
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) return `${total} сек`;
  const minutes = Math.ceil(total / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} ч ${remainder} мин` : `${hours} ч`;
}

function clipStateLabel(status: string) {
  if (status === "ready") return "Готово";
  if (status === "failed") return "Ошибка";
  if (status === "rendering") return "Рендер";
  return "В очереди";
}

function formatRetentionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "в указанную дату";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function pluralize(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^\p{Letter}\p{Number}-]+/gu, "-").replace(/^-|-$/g, "").slice(0, 80) || "narezai-clip";
}
