"use client";

import { Button, TextArea } from "@heroui/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  LayoutTemplate,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Subtitles,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { moments as demoMoments, readyClips as demoClips, transcript as demoTranscript } from "../data";
import { handleTablistKeyDown } from "../lib/a11y";
import {
  ControlApiError,
  createMomentSearch,
  createTranscriptRevision,
  getClipPlayback,
  getProject,
  updateProject,
  getTranscript,
  isControlApiConfigured,
  renderSelectedMoments,
  updateMoment,
} from "../lib/control-api";
import { activeProcessingStatuses } from "../lib/processing-stages";
import { trackApp } from "../lib/track-app";
import { useProjectProcessing } from "../lib/use-project-processing";
import { useDashboardStore } from "../store";
import type { ClipResult, MomentCandidate } from "../types";
import { Drawer } from "./ui/Drawer";
import { LockedField } from "./ui/LockedField";
import { ProcessingCard } from "./ui/ProcessingCard";
import { Select } from "./ui/Select";
import { SubtitlePreviewOverlay } from "./ui/SubtitlePreviewOverlay";
import { StatusBadge } from "./ui/StatusBadge";
import { Switch } from "./ui/Switch";

type Tab = "moments" | "ready";
type RenderState = "review" | "rendering" | "ready" | "partial";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "moments", label: "Моменты" },
  { id: "ready", label: "Готовые клипы" },
];

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function durationBetween(startMs: number, endMs: number) {
  return formatTime(endMs - startMs);
}

function formatSourceDuration(durationMs: number | null) {
  if (durationMs === null) return "Определяется";
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function clockToMs(clock: string) {
  const [minutes, seconds] = clock.split(":").map(Number);
  return ((minutes * 60) + seconds) * 1000;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function ProjectWorkspace({ projectId = "podcast-24" }: { projectId?: string }) {
  const { styles, defaultStyleId } = useDashboardStore();
  const canUseApi = isControlApiConfigured() && isUuid(projectId);
  const [tab, setTab] = useState<Tab>("moments");
  const [items, setItems] = useState<MomentCandidate[]>(demoMoments);
  const [clips, setClips] = useState<ClipResult[]>(demoClips);
  const [projectTitle, setProjectTitle] = useState("Подкаст №24 — как запускать продукты");
  const [activeId, setActiveId] = useState(demoMoments[0].id);
  const [renderState, setRenderState] = useState<RenderState>("review");
  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ kind: "upload" | "youtube"; durationMs: number | null } | null>(null);
  const [search, setSearch] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState(demoTranscript.map((line) => line.text).join("\n\n"));
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const [transcriptSegments, setTranscriptSegments] = useState<Array<{ id: string; text: string }>>([]);
  const [realTranscriptLines, setRealTranscriptLines] = useState<
    Array<{ time: string; speaker: string; text: string; startMs: number }>
  >([]);
  const [transcriptLoaded, setTranscriptLoaded] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [styleOverride, setStyleOverride] = useState<string | null>(null);
  const [captions, setCaptions] = useState(true);
  const [silence, setSilence] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const styleId = styleOverride ?? defaultStyleId;

  const selected = items.filter((item) => item.selected);
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const currentStyle = styles.find((style) => style.id === styleId) ?? styles[0];
  const filteredTranscript = useMemo(() => {
    const source = canUseApi
      ? realTranscriptLines.map((line) => ({
          time: line.time,
          speaker: line.speaker,
          text: line.text,
          active: Boolean(
            active
            && line.startMs >= clockToMs(active.start)
            && line.startMs <= clockToMs(active.end),
          ),
        }))
      : demoTranscript;
    return source.filter((line) => line.text.toLowerCase().includes(search.toLowerCase()));
  }, [canUseApi, realTranscriptLines, active, search]);

  const loadProject = useCallback(() => {
    return getProject(projectId).then((response) => {
      setProjectTitle(response.project.title);
      setProjectStatus(response.project.status);
      setSourceInfo(response.source ? { kind: response.source.kind, durationMs: response.source.durationMs } : null);
      const apiMoments = response.moments.map<MomentCandidate>((moment) => ({
        id: moment.id,
        title: moment.title,
        topic: moment.topic,
        start: formatTime(moment.startMs),
        end: formatTime(moment.endMs),
        duration: durationBetween(moment.startMs, moment.endMs),
        excerpt: moment.explanation,
        reason: moment.explanation,
        selected: moment.selected,
        speaker: "Автоматически",
        score: Number(moment.score ?? 0),
        warnings: moment.warnings,
        layout: "auto",
      }));
      // Always reflect the real result, including zero moments — a
      // brand-new or still-processing project genuinely has none yet, and
      // silently keeping the initial mock `demoMoments` here (the old
      // behavior, gated on `apiMoments.length`) meant a real user opening
      // a real, not-yet-processed project saw 5 fabricated moments about
      // an unrelated demo podcast as if the AI had already analyzed their
      // video. See `backend-capability-map`.
      setItems(apiMoments);
      setActiveId(apiMoments[0]?.id ?? "");
      setClips(response.clips.map((clip) => ({
        id: clip.id,
        momentId: clip.momentCandidateId ?? "",
        title: clip.title,
        topic: "Готовый клип",
        duration: "—",
        status: clip.status as ClipResult["status"],
        version: clip.currentVersion,
      })));
      if (response.project.status === "ready") setRenderState("ready");
      else if (response.project.status === "partially_ready") setRenderState("partial");
      else if (response.project.status === "rendering") setRenderState("rendering");
      return response.project.status;
    });
  }, [projectId]);

  useEffect(() => {
    if (!canUseApi) return;
    let cancelled = false;
    loadProject().catch((error: unknown) => {
      if (!cancelled) setNotice(error instanceof ControlApiError ? error.message : "Не удалось загрузить проект. Проверьте соединение и попробуйте ещё раз.");
    });
    return () => {
      cancelled = true;
    };
  }, [canUseApi, projectId, loadProject]);

  // The one-shot fetch above can catch a project mid-analysis; poll its
  // status live so this page reflects completion without a manual reload,
  // matching the wizard's own processing screen (see ProcessingCard below).
  const { status: liveStatus, processingIndex, secondsInStage } = useProjectProcessing(canUseApi ? projectId : null);
  useEffect(() => {
    if (!liveStatus || activeProcessingStatuses.has(liveStatus)) return;
    // Status just left the "still analyzing" set — re-fetch so the real
    // moments/clips replace the empty placeholder instead of the page being
    // stuck showing "Ищем сильные моменты" (or "не найдены") forever.
    if (projectStatus && activeProcessingStatuses.has(projectStatus)) {
      void loadProject().catch(() => {});
    }
  }, [liveStatus, projectStatus, loadProject]);

  useEffect(() => {
    if (!transcriptOpen || !canUseApi) return;
    void getTranscript(projectId)
      .then((response) => {
        setTranscriptError(null);
        const segments = response.segments.map((segment) => ({ id: segment.id, text: segment.originalText }));
        setTranscriptSegments(segments);
        setTranscriptRevision(response.transcript.revision);
        setTranscriptDraft(segments.map((segment) => segment.text).join("\n\n"));

        const speakerLabels = new Map<string, string>();
        const letters = "АБВГДЕЖЗИК";
        setRealTranscriptLines(response.segments.map((segment) => {
          const speakerId = segment.speakerId ?? "";
          if (speakerId && !speakerLabels.has(speakerId)) {
            speakerLabels.set(speakerId, `Спикер ${letters[speakerLabels.size] ?? speakerLabels.size + 1}`);
          }
          return {
            time: formatTime(segment.startMs),
            speaker: speakerId ? speakerLabels.get(speakerId)! : "Спикер",
            text: segment.originalText,
            startMs: segment.startMs,
          };
        }));
      })
      .catch((error: unknown) => {
        setTranscriptError(error instanceof ControlApiError ? error.message : "Не удалось загрузить транскрипт. Проверьте соединение и попробуйте ещё раз.");
      })
      .finally(() => setTranscriptLoaded(true));
  }, [canUseApi, projectId, transcriptOpen]);

  useEffect(() => {
    if (!settingsOpen && !transcriptOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      setTranscriptOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen, transcriptOpen]);

  const toggleMoment = async (id: string) => {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const selectedState = !current.selected;
    setItems((list) => list.map((item) => item.id === id ? { ...item, selected: selectedState } : item));
    trackApp("moment_select", { projectId, momentId: id, selected: selectedState });
    if (canUseApi) {
      try {
        await updateMoment(projectId, id, { selected: selectedState });
      } catch (error) {
        setItems((list) => list.map((item) => item.id === id ? { ...item, selected: current.selected } : item));
        setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить выбор. Проверьте соединение и попробуйте ещё раз.");
      }
    }
  };

  const updateActive = async (patch: Partial<MomentCandidate>) => {
    const before = active;
    setItems((list) => list.map((item) => item.id === active.id ? { ...item, ...patch } : item));
    if (!canUseApi) return;
    try {
      await updateMoment(projectId, active.id, { title: patch.title });
    } catch (error) {
      setItems((list) => list.map((item) => item.id === active.id ? before : item));
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить момент. Проверьте соединение и попробуйте ещё раз.");
    }
  };

  const startRender = async () => {
    if (!selected.length) return;
    setBusy(true);
    setRenderState("rendering");
    setTab("ready");
    trackApp("render_start", { clips: selected.length });
    try {
      if (canUseApi) {
        const response = await renderSelectedMoments(projectId, selected.map((item) => item.id));
        setClips(response.items.map(({ clip }, index) => ({
          id: clip.id,
          momentId: clip.momentCandidateId ?? "",
          title: clip.title,
          topic: selected[index]?.topic ?? "Клип",
          duration: selected[index]?.duration ?? "—",
          status: "queued",
          version: 0,
        })));
      } else {
        setClips(selected.map((moment, index) => ({
          id: `clip-${index + 1}`,
          momentId: moment.id,
          title: moment.title,
          topic: moment.topic,
          duration: moment.duration,
          status: index === selected.length - 1 ? "rendering" : "ready",
          version: 1,
        })));
      }
      setNotice("Рендер запущен. Страницу можно закрыть — проект продолжит работу.");
    } catch (error) {
      setRenderState("review");
      setTab("moments");
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось запустить рендер. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  // These three drove nothing before: the selects were uncontrolled and
  // recompute() sent hardcoded values, so changing them did nothing.
  const [searchMode, setSearchMode] = useState<"tips" | "best" | "opinions" | "stories" | "custom">("tips");
  const [searchCount, setSearchCount] = useState("recommended");
  const [searchDuration, setSearchDuration] = useState("medium");

  const durationRange: Record<string, { min: number; max: number }> = {
    short: { min: 15, max: 30 },
    medium: { min: 30, max: 60 },
    long: { min: 60, max: 90 },
  };

  const [downloadingClipId, setDownloadingClipId] = useState<string | null>(null);

  const downloadClip = async (clipId: string, title: string) => {
    if (!canUseApi) {
      setNotice("Скачивание доступно после подключения API.");
      return;
    }
    setDownloadingClipId(clipId);
    try {
      const playback = await getClipPlayback(projectId, clipId);
      const link = document.createElement("a");
      link.href = playback.url;
      link.download = `${title}.mp4`;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      trackApp("clip_download", { clipId });
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось получить ссылку на файл. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setDownloadingClipId(null);
    }
  };

  const [boundaryStart, setBoundaryStart] = useState<string | null>(null);
  const [boundaryEnd, setBoundaryEnd] = useState<string | null>(null);

  /** First click sets the start, the next one the end; a third starts over. */
  const pickBoundary = (clock: string) => {
    if (!boundaryStart || (boundaryStart && boundaryEnd)) {
      setBoundaryStart(clock);
      setBoundaryEnd(null);
      return;
    }
    if (clockToMs(clock) < clockToMs(boundaryStart)) {
      setBoundaryEnd(boundaryStart);
      setBoundaryStart(clock);
      return;
    }
    setBoundaryEnd(clock);
  };

  const applyBoundaries = async () => {
    if (!boundaryStart || !boundaryEnd || !active) {
      setTranscriptOpen(false);
      return;
    }
    setBusy(true);
    try {
      if (canUseApi) {
        await updateMoment(projectId, active.id, {
          startMs: clockToMs(boundaryStart),
          endMs: clockToMs(boundaryEnd),
        });
      }
      trackApp("moment_boundaries_apply", { projectId, momentId: active.id });
      setNotice(`Границы момента обновлены: ${boundaryStart}\u2013${boundaryEnd}.`);
      setBoundaryStart(null);
      setBoundaryEnd(null);
      setTranscriptOpen(false);
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить границы. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const applyStyle = async () => {
    setBusy(true);
    try {
      if (canUseApi) {
        await updateProject(projectId, {
          settings: {
            styleId,
            projectOverrides: {
              captionsEnabled: captions,
              silenceRemoval: silence,
            },
          },
        });
      }
      trackApp("style_apply", { style: styleId });
      setNotice("Стиль и параметры сохранены. Они применятся к следующим рендерам клипов.");
      setSettingsOpen(false);
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить параметры проекта. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const recompute = async () => {
    setBusy(true);
    try {
      if (canUseApi) {
        await createMomentSearch(projectId, {
          mode: searchMode,
          count: searchCount === "recommended" ? "recommended" : Number(searchCount),
          durationMinSeconds: durationRange[searchDuration].min,
          durationMaxSeconds: durationRange[searchDuration].max,
          diversity: "high",
          selectionStrictness: "balanced",
          allowThoughtCompletion: true,
          excludedTopics: [],
          resultMode: "append",
        });
      }
      trackApp("moments_recompute", { projectId });
      setNotice("Новый поиск запущен по готовому транскрипту. Минуты не списываются повторно.");
      setSettingsOpen(false);
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось запустить повторный поиск. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const saveTranscriptRevision = async () => {
    setBusy(true);
    try {
      if (canUseApi && transcriptSegments.length) {
        const parts = transcriptDraft.split(/\n\s*\n/);
        const operations = transcriptSegments.flatMap((segment, index) => {
          const text = parts[index]?.trim();
          return text && text !== segment.text
            ? [{ type: "replace_text" as const, segmentId: segment.id, text }]
            : [];
        });
        if (operations.length) {
          const response = await createTranscriptRevision(projectId, {
            expectedRevision: transcriptRevision,
            operations,
          });
          setTranscriptRevision(response.revision.revision);
          setTranscriptSegments((segments) => segments.map((segment, index) => ({
            ...segment,
            text: parts[index]?.trim() || segment.text,
          })));
        }
      }
      setEditingTranscript(false);
      setNotice("Создана новая версия транскрипта. Исходное распознавание сохранено.");
      trackApp("transcript_edit", { projectId });
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить транскрипт. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="project-workspace">
      <header className="project-header">
        <div className="project-header__title">
          <Link href="/dashboard/projects" aria-label="Назад к проектам"><ArrowLeft size={19} /></Link>
          <div>
            <StatusBadge tone={renderState === "ready" ? "success" : "accent"}>
              {renderState === "review" ? "Нужна проверка" : renderState === "rendering" ? "Создаём клипы" : renderState === "partial" ? "Частично готово" : "Готово"}
            </StatusBadge>
            <h1>{projectTitle}</h1>
            <p>
              {canUseApi && sourceInfo
                ? <>{sourceInfo.kind === "youtube" ? "YouTube" : "Файл"} · {formatSourceDuration(sourceInfo.durationMs)} · стиль «{currentStyle.name}»</>
                : <>YouTube · 01:03:42 · стиль «{currentStyle.name}» · исходник оплачен один раз</>}
            </p>
          </div>
        </div>
        <div className="project-header__actions">
          <Button variant="outline" onPress={() => setTranscriptOpen(true)}>
            <FileText size={18} />
            Транскрипт
          </Button>
          <Button variant="outline" onPress={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
            Параметры
          </Button>
          {tab === "moments" ? (
            <Button isDisabled={!selected.length || busy} onPress={startRender}>
              {busy ? <LoaderCircle className="is-spinning" size={18} /> : <Sparkles size={18} />}
              Создать клипы · {selected.length}
            </Button>
          ) : (
            <span className="dash-action-with-hint">
              <Button isDisabled variant="outline">
                <FileArchive size={18} />
                Скачать ZIP
              </Button>
              <small>Пакетная выгрузка появится вместе с архивацией проектов</small>
            </span>
          )}
        </div>
      </header>

      {notice ? (
        <div className="project-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Скрыть сообщение" onClick={() => setNotice("")}><X size={17} /></button>
        </div>
      ) : null}

      <div className="project-tabs" role="tablist" aria-label="Основные режимы проекта" onKeyDown={handleTablistKeyDown}>
        {tabs.map((item) => (
          <button
            role="tab"
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "is-active" : ""}
            type="button"
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span>{item.id === "moments" ? items.length : clips.length}</span>
          </button>
        ))}
      </div>

      {renderState === "rendering" ? (
        <div className="project-render-banner">
          <LoaderCircle className="is-spinning" size={21} />
          <div>
            <strong>Клипы создаются независимо</strong>
            <span>Готовые появятся по одному. Ошибка одного клипа не остановит остальные.</span>
          </div>
          <span>Обычно 9–16 минут</span>
        </div>
      ) : null}

      {tab === "moments" && canUseApi && !items.length ? (
        projectStatus && activeProcessingStatuses.has(projectStatus) ? (
          <div className="project-processing">
            <ProcessingCard
              sourceName={projectTitle}
              status={liveStatus}
              processingIndex={processingIndex}
              secondsInStage={secondsInStage}
            />
          </div>
        ) : (
          <div className="project-empty-results">
            <Sparkles size={26} />
            <h3>Моменты не найдены</h3>
            <p>Не удалось выделить законченные мысли в этом видео. Попробуйте уточнить запрос.</p>
            <Button onPress={() => setSettingsOpen(true)}>Найти иначе</Button>
          </div>
        )
      ) : tab === "moments" ? (
        <div className="project-review-layout">
          <section className="moment-list" aria-label="Найденные моменты">
            <div className="moment-list__head">
              <div>
                <span className="dash-eyebrow">Найдено {items.length}</span>
                <h2>Выберите, что превратить в клипы</h2>
                <p>Границы, кадр и текст каждого момента можно исправить до рендера.</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(true)}>
                <RotateCcw size={16} />
                Найти иначе
              </button>
            </div>

            {items.map((moment, index) => (
              <article className={`moment-row ${activeId === moment.id ? "is-active" : ""}`} key={moment.id}>
                <button
                  className={`moment-check ${moment.selected ? "is-selected" : ""}`}
                  type="button"
                  aria-label={`${moment.selected ? "Исключить" : "Выбрать"} момент «${moment.title}»`}
                  aria-pressed={moment.selected}
                  onClick={() => void toggleMoment(moment.id)}
                >
                  {moment.selected ? <Check size={16} /> : index + 1}
                </button>
                <button className="moment-row__content" type="button" onClick={() => setActiveId(moment.id)}>
                  <span className="moment-row__top">
                    <span>{moment.topic}</span>
                    <time>{moment.start}–{moment.end} · {moment.duration}</time>
                  </span>
                  <strong>{moment.title}</strong>
                  <p>{moment.excerpt}</p>
                  {moment.warnings?.length ? (
                    <span className="moment-row__warning"><AlertTriangle size={13} /> {moment.warnings[0]}</span>
                  ) : null}
                </button>
                <button className="moment-row__open" type="button" aria-label="Открыть момент" onClick={() => setActiveId(moment.id)}>
                  <ChevronRight size={19} />
                </button>
              </article>
            ))}
          </section>

          <aside className="moment-inspector">
            <div className="moment-preview">
              <span className="dash-media-mark">HP</span>
              <SubtitlePreviewOverlay
                text={active.title.toUpperCase()}
                preset={currentStyle.subtitlePreset}
                fontFamily={currentStyle.fontFamily}
                position={currentStyle.subtitlePosition}
                color={currentStyle.colors[0]}
                activeColor={currentStyle.colors[1]}
              />
              <small>{active.start} / {active.end}</small>
            </div>
            <div className="moment-inspector__body">
              <span className="dash-eyebrow">{active.topic}</span>
              <label className="moment-title-field">
                <span className="sr-only">Название момента</span>
                <input
                  value={active.title}
                  onChange={(event) => setItems((list) => list.map((item) => item.id === active.id ? { ...item, title: event.target.value } : item))}
                  onBlur={(event) => void updateActive({ title: event.target.value })}
                />
                <Pencil size={15} />
              </label>
              <p>{active.reason}</p>
              <div className="moment-technical-summary">
                <span><strong>{active.start}–{active.end}</strong><small>Границы по словам</small></span>
                <span><strong>{active.speaker}</strong><small>Спикер</small></span>
              </div>
              <LockedField
                icon={<LayoutTemplate size={17} />}
                label="Кадр момента"
                reason="Свой формат для отдельного момента — пока недоступно, используется формат проекта"
              />
              <button className="moment-inspector__edit" type="button" onClick={() => setTranscriptOpen(true)}>
                Изменить границы по тексту
                <ChevronRight size={17} />
              </button>
            </div>
          </aside>
        </div>
      ) : (
        <section className="project-results">
          <div className="project-results__head">
            <div>
              <span className="dash-eyebrow">{clips.filter((clip) => clip.status === "ready").length} из {clips.length} готово</span>
              <h2>Клипы появляются по одному</h2>
              <p>Откройте клип, исправьте текст, кадр или оформление и перерендерите только его.</p>
            </div>
            <span className="dash-action-with-hint">
              <Button isDisabled variant="outline">
                <FileArchive size={18} />
                Скачать готовые ZIP
              </Button>
              <small>Пакетная выгрузка появится вместе с архивацией проектов</small>
            </span>
          </div>
          {clips.length ? (
            <div className="result-clip-grid">
              {clips.map((clip, index) => (
                <article className="result-clip" key={clip.id}>
                  <div className={`result-clip__media result-tone-${index % 3}`}>
                    <StatusBadge tone={clip.status === "ready" ? "success" : clip.status === "failed" ? "danger" : "accent"}>
                      {clip.status === "ready" ? <Check size={13} /> : clip.status === "failed" ? <AlertTriangle size={13} /> : <LoaderCircle className="is-spinning" size={13} />}
                      {clip.status === "ready" ? "Готово" : clip.status === "failed" ? "Ошибка клипа" : "В очереди"}
                    </StatusBadge>
                    <span className="dash-media-mark">HP</span>
                    <div><span>ОДНА МЫСЛЬ</span><strong>СТАНОВИТСЯ</strong><span>ЦЕЛЫМ КЛИПОМ</span></div>
                    <small>{clip.duration}</small>
                  </div>
                  <h3>{clip.title}</h3>
                  <p>{clip.topic} · версия {clip.version || "готовится"}</p>
                  <div className="result-clip__actions">
                    <Button
                      isDisabled={clip.status !== "ready" || downloadingClipId === clip.id}
                      variant="outline"
                      onPress={() => void downloadClip(clip.id, clip.title)}
                    >
                      {downloadingClipId === clip.id
                        ? <LoaderCircle className="is-spinning" size={17} />
                        : <Download size={17} />}
                      MP4
                    </Button>
                    <Link
                      href={`/dashboard/projects/${projectId}/clips/${clip.id}`}
                      onClick={() => trackApp("clip_editor_open", { projectId, clipId: clip.id })}
                    >
                      Изменить
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="project-empty-results">
              <Sparkles size={26} />
              <h3>Сначала выберите моменты</h3>
              <p>После запуска здесь будут отдельно появляться готовые клипы.</p>
              <Button onPress={() => setTab("moments")}>Вернуться к моментам</Button>
            </div>
          )}
        </section>
      )}

      <Drawer
        isOpen={transcriptOpen}
        onOpenChange={setTranscriptOpen}
        title="Транскрипт"
        description="Синхронизировано с видео"
        className="transcript-drawer"
        footer={
          <>
            <Button variant="outline" onPress={() => setEditingTranscript((value) => !value)}>
              <Pencil size={17} />
              {editingTranscript ? "Закрыть правку" : "Исправить текст"}
            </Button>
            <Button isDisabled={busy || !boundaryStart || !boundaryEnd} onPress={() => void applyBoundaries()}>
              {busy ? <LoaderCircle className="is-spinning" size={17} /> : null}
              Применить границы
            </Button>
          </>
        }
      >
        <p className="transcript-drawer__hint">Отметьте начало и конец по репликам или исправьте написание. Исходная версия сохранится.</p>
            <label className="dash-search transcript-search">
              <Search size={18} />
              <span className="sr-only">Найти в транскрипте</span>
              <input type="search" placeholder="Найти слово или фразу" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {editingTranscript ? (
              <div className="transcript-editor">
                <TextArea
                  fullWidth
                  rows={14}
                  value={transcriptDraft}
                  variant="secondary"
                  onChange={(event) => setTranscriptDraft(event.target.value)}
                />
                <div>
                  <Button variant="outline" onPress={() => setEditingTranscript(false)}>Отменить</Button>
                  <Button isDisabled={busy} onPress={saveTranscriptRevision}>{busy ? <LoaderCircle className="is-spinning" size={17} /> : null}Сохранить версию</Button>
                </div>
              </div>
            ) : canUseApi && !filteredTranscript.length && !search ? (
              <p className="transcript-drawer__hint">
                {transcriptError
                  ? `Не удалось загрузить транскрипт: ${transcriptError}`
                  : transcriptLoaded
                    ? "Транскрипт ещё не готов для этого проекта — распознавание речи не завершено или не поддерживается текущим провайдером."
                    : "Загрузка транскрипта…"}
              </p>
            ) : (
              <div className="transcript-lines">
                {filteredTranscript.map((line) => (
                  <button
                    className={
                      line.time === boundaryStart || line.time === boundaryEnd
                        ? "is-boundary"
                        : line.active ? "is-active" : ""
                    }
                    type="button"
                    key={`${line.time}-${line.text}`}
                    onClick={() => pickBoundary(line.time)}
                  >
                    <time>{line.time}</time>
                    <span><strong>{line.speaker}</strong><p>{line.text}</p></span>
                    {line.time === boundaryStart ? <span className="transcript-line-mark">Начало</span>
                      : line.time === boundaryEnd ? <span className="transcript-line-mark">Конец</span>
                        : line.active ? <span className="transcript-line-mark">В моменте</span> : null}
                  </button>
                ))}
              </div>
            )}
      </Drawer>

      <Drawer
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Параметры проекта"
        description="Без повторной транскрипции"
        className="project-settings-drawer"
        footer={
          <>
            <Button isDisabled={busy} variant="outline" onPress={recompute}>
              {busy ? <LoaderCircle className="is-spinning" size={17} /> : <RotateCcw size={17} />}
              Найти ещё
            </Button>
            <Button isDisabled={busy} onPress={() => void applyStyle()}>
              {busy ? <LoaderCircle className="is-spinning" size={17} /> : null}
              Применить стиль
            </Button>
          </>
        }
      >
        <p className="transcript-drawer__hint">Поиск и стиль собраны здесь, а не разбросаны по отдельным вкладкам.</p>

        <section>
          <h3>Что найти</h3>
          <label className="drawer-field"><span>Задача</span><Select
            aria-label="Задача"
            value={searchMode}
            onChange={(value) => setSearchMode(value as typeof searchMode)}
            options={[
              { id: "tips", label: "Практические советы" },
              { id: "best", label: "Лучшие моменты" },
              { id: "opinions", label: "Сильные мнения" },
              { id: "stories", label: "Истории" },
              { id: "custom", label: "Свой запрос" },
            ]}
          /></label>
          <div className="project-settings-drawer__pair">
            <label className="drawer-field"><span>Количество</span><Select
              aria-label="Количество"
              value={searchCount}
              onChange={setSearchCount}
              options={[
                { id: "recommended", label: "Рекомендуемое" },
                { id: "6", label: "Ровно 6" },
                { id: "8", label: "Ровно 8" },
              ]}
            /></label>
            <label className="drawer-field"><span>Длительность</span><Select
              aria-label="Длительность"
              value={searchDuration}
              onChange={setSearchDuration}
              options={[
                { id: "short", label: "До 30 сек." },
                { id: "medium", label: "30–60 сек." },
                { id: "long", label: "60–90 сек." },
              ]}
            /></label>
          </div>
        </section>

            <section>
              <h3>Как оформить</h3>
              <div className="project-drawer-styles">
                {styles.map((style) => (
                  <button
                    className={styleId === style.id ? "is-selected" : ""}
                    type="button"
                    key={style.id}
                    onClick={() => {
                      setStyleOverride(style.id);
                      setCaptions(style.captions !== "Выключены");
                      setSilence(style.silenceRemoval);
                    }}
                  >
                    <span style={{ background: `linear-gradient(135deg, ${style.colors[0]} 50%, ${style.colors[1]} 50%)` }} />
                    <b>{style.name}</b>
                    {styleId === style.id ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>
              <div className="project-setting-row">
                <span><Subtitles size={19} /><span><strong>Субтитры</strong><small>Применить к выбранным клипам</small></span></span>
                <Switch checked={captions} aria-label="Субтитры" onCheckedChange={setCaptions} />
              </div>
              <div className="project-setting-row">
                <span><WandSparkles size={19} /><span><strong>Удаление пауз</strong><small>Не обрезать окончания фраз</small></span></span>
                <Switch checked={silence} aria-label="Удаление пауз" onCheckedChange={setSilence} />
              </div>
              <Link href="/dashboard/styles">Управление сохранёнными стилями <ChevronRight size={16} /></Link>
            </section>

            <div className="project-warning">
              <AlertTriangle size={18} />
              <span><strong>Минуты не спишутся повторно.</strong> Новый поиск использует сохранённый транскрипт.</span>
            </div>

      </Drawer>
    </main>
  );
}
