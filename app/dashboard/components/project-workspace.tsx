"use client";

import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Download02Icon,
  File01Icon,
  FileArchiveIcon,
  Layout05Icon,
  MagicWand01Icon,
  PencilEdit02Icon,
  RotateLeft02Icon,
  Search01Icon,
  Settings02Icon,
  SparklesIcon,
  SubtitleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { AppIcon } from "@/components/hashpix/app-icon";
import { AsyncButton } from "@/components/hashpix/async-button";
import { IconButton } from "@/components/hashpix/icon-button";
import { StatusBadge } from "@/components/hashpix/status-badge";
import { PageDescription, PageTitle, SectionDescription, SectionTitle } from "@/components/hashpix/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { moments as demoMoments, readyClips as demoClips, transcript as demoTranscript } from "../data";
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
import { LockedField } from "@/components/hashpix/locked-field";
import { MediaThumb } from "@/components/hashpix/media-thumb";
import { ProcessingCard } from "@/components/hashpix/processing-card";
import { SubtitlePreviewOverlay } from "@/components/hashpix/subtitle-preview-overlay";

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
  const [sourceInfo, setSourceInfo] = useState<{
    kind: "upload" | "youtube";
    durationMs: number | null;
    thumbnailUrl: string | null;
  } | null>(null);
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
      setSourceInfo(response.source ? {
        kind: response.source.kind,
        durationMs: response.source.durationMs,
        thumbnailUrl: typeof response.source.metadata.thumbnailUrl === "string"
          ? response.source.metadata.thumbnailUrl
          : null,
      } : null);
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
  const { status: liveStatus, processingIndex, secondsInStage, progress: processingProgress } = useProjectProcessing(canUseApi ? projectId : null);
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
      setNotice("Не удалось подготовить файл для скачивания. Попробуйте позже.");
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
          <Button
            nativeButton={false}
            render={<Link href="/dashboard/projects" />}
            variant="outline"
            size="icon"
            aria-label="Назад к проектам"
          >
            <AppIcon icon={ArrowLeft01Icon} aria-hidden="true" />
          </Button>
          <div>
            <StatusBadge tone={renderState === "ready" ? "success" : "accent"}>
              {renderState === "review" ? "Нужна проверка" : renderState === "rendering" ? "Создаём клипы" : renderState === "partial" ? "Частично готово" : "Готово"}
            </StatusBadge>
            <PageTitle>{projectTitle}</PageTitle>
            <PageDescription>
              {canUseApi && sourceInfo
                ? <>{sourceInfo.kind === "youtube" ? "YouTube" : "Файл"} · {formatSourceDuration(sourceInfo.durationMs)} · стиль «{currentStyle.name}»</>
                : <>YouTube · 01:03:42 · стиль «{currentStyle.name}» · исходник оплачен один раз</>}
            </PageDescription>
          </div>
        </div>
        <div className="project-header__actions">
          <AsyncButton variant="secondary" onClick={() => setTranscriptOpen(true)}>
            <AppIcon icon={File01Icon} size="sm" aria-hidden="true" />
            Транскрипт
          </AsyncButton>
          <AsyncButton variant="secondary" onClick={() => setSettingsOpen(true)}>
            <AppIcon icon={Settings02Icon} size="sm" aria-hidden="true" />
            Параметры
          </AsyncButton>
          {tab === "moments" ? (
            <AsyncButton loading={busy} disabled={!selected.length} onClick={startRender}>
              {!busy ? <AppIcon icon={SparklesIcon} size="sm" aria-hidden="true" /> : null}
              Создать клипы · {selected.length}
            </AsyncButton>
          ) : (
            <span className="dash-action-with-hint">
              <AsyncButton disabled variant="secondary">
                <AppIcon icon={FileArchiveIcon} size="sm" aria-hidden="true" />
                Скачать ZIP
              </AsyncButton>
              <small>Пакетная выгрузка появится вместе с архивацией проектов</small>
            </span>
          )}
        </div>
      </header>

      {notice ? (
        <div className="project-notice" role="status">
          <span>{notice}</span>
          <IconButton label="Скрыть сообщение" tooltip="Закрыть" variant="ghost" onClick={() => setNotice("")}>
            <AppIcon icon={Cancel01Icon} size="sm" aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      <Tabs
        className="project-tabs"
        aria-label="Основные режимы проекта"
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
      >
        <TabsList>
          {tabs.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
              <Badge variant="secondary">{item.id === "moments" ? items.length : clips.length}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {renderState === "rendering" ? (
        <Card className="project-render-banner px-5 py-4">
          <AppIcon icon={SparklesIcon} aria-hidden="true" />
          <div>
            <strong>Клипы создаются независимо</strong>
            <span>Готовые появятся по одному. Ошибка одного клипа не остановит остальные.</span>
          </div>
          <span>Обычно 9–16 минут</span>
        </Card>
      ) : null}

      {tab === "moments" && canUseApi && !items.length ? (
        projectStatus && activeProcessingStatuses.has(projectStatus) ? (
          <div className="project-processing">
            <ProcessingCard
              sourceName={projectTitle}
              status={liveStatus}
              processingIndex={processingIndex}
              secondsInStage={secondsInStage}
              progress={processingProgress}
            />
          </div>
        ) : (
          <Card className="project-empty-results">
            <AppIcon icon={SparklesIcon} size="lg" aria-hidden="true" />
            <SectionTitle>Моменты не найдены</SectionTitle>
            <SectionDescription>Не удалось выделить законченные мысли в этом видео. Попробуйте уточнить запрос.</SectionDescription>
            <AsyncButton onClick={() => setSettingsOpen(true)}>Найти иначе</AsyncButton>
          </Card>
        )
      ) : tab === "moments" ? (
        <div className="project-review-layout">
          <section className="moment-list" aria-label="Найденные моменты">
            <div className="moment-list__head">
              <div>
                <span className="dash-eyebrow">Найдено {items.length}</span>
                <SectionTitle>Выберите, что превратить в клипы</SectionTitle>
                <SectionDescription>Границы, кадр и текст каждого момента можно исправить до рендера.</SectionDescription>
              </div>
              <AsyncButton variant="secondary" onClick={() => setSettingsOpen(true)}>
                <AppIcon icon={RotateLeft02Icon} size="sm" aria-hidden="true" />
                Найти иначе
              </AsyncButton>
            </div>

            {items.map((moment, index) => (
              <article className={`moment-row ${activeId === moment.id ? "is-active" : ""}`} key={moment.id}>
                <Button
                  variant={moment.selected ? "default" : "outline"}
                  size="icon"
                  className="moment-check"
                  type="button"
                  aria-label={`${moment.selected ? "Исключить" : "Выбрать"} момент «${moment.title}»`}
                  aria-pressed={moment.selected}
                  onClick={() => void toggleMoment(moment.id)}
                >
                  {moment.selected ? <AppIcon icon={Tick02Icon} size="sm" aria-hidden="true" /> : index + 1}
                </Button>
                <Button variant="ghost" className="moment-row__content h-auto min-h-0 flex-1 items-start justify-start px-0 py-0 text-left whitespace-normal" type="button" onClick={() => setActiveId(moment.id)}>
                  <span className="moment-row__top">
                    <span>{moment.topic}</span>
                    <time>{moment.start}–{moment.end} · {moment.duration}</time>
                  </span>
                  <strong>{moment.title}</strong>
                  <p>{moment.excerpt}</p>
                  {moment.warnings?.length ? (
                    <span className="moment-row__warning"><AppIcon icon={Alert02Icon} size="sm" aria-hidden="true" /> {moment.warnings[0]}</span>
                  ) : null}
                </Button>
                <Button variant="ghost" size="icon" className="moment-row__open" type="button" aria-label="Открыть момент" onClick={() => setActiveId(moment.id)}>
                  <AppIcon icon={ArrowRight01Icon} aria-hidden="true" />
                </Button>
              </article>
            ))}
          </section>

          <Card className="moment-inspector gap-0 py-0">
            <div className="moment-preview">
              <MediaThumb
                className="moment-preview__source"
                src={sourceInfo?.thumbnailUrl ?? undefined}
                alt={projectTitle}
                tone="ink"
              />
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
            <CardContent className="moment-inspector__body">
              <span className="dash-eyebrow">{active.topic}</span>
              <Field className="moment-title-field">
                <Input
                  aria-label="Название момента"
                  value={active.title}
                  onChange={(event) => setItems((list) => list.map((item) => item.id === active.id ? { ...item, title: event.target.value } : item))}
                  onBlur={(event) => void updateActive({ title: event.target.value })}
                />
              </Field>
              <p>{active.reason}</p>
              <div className="moment-technical-summary">
                <span><strong>{active.start}–{active.end}</strong><small>Границы по словам</small></span>
                <span><strong>{active.speaker}</strong><small>Спикер</small></span>
              </div>
              <LockedField
                icon={<AppIcon icon={Layout05Icon} size="sm" aria-hidden="true" />}
                label="Кадр момента"
                reason="Свой формат для отдельного момента — пока недоступно, используется формат проекта"
              />
              <AsyncButton className="moment-inspector__edit w-full justify-between" variant="ghost" onClick={() => setTranscriptOpen(true)}>
                Изменить границы по тексту
                <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
              </AsyncButton>
            </CardContent>
          </Card>
        </div>
      ) : (
        <section className="project-results">
          <div className="project-results__head">
            <div>
              <span className="dash-eyebrow">{clips.filter((clip) => clip.status === "ready").length} из {clips.length} готово</span>
              <SectionTitle>Клипы появляются по одному</SectionTitle>
              <SectionDescription>Откройте клип, исправьте текст, кадр или оформление и перерендерите только его.</SectionDescription>
            </div>
            <span className="dash-action-with-hint">
              <AsyncButton disabled variant="secondary">
                <AppIcon icon={FileArchiveIcon} size="sm" aria-hidden="true" />
                Скачать готовые ZIP
              </AsyncButton>
              <small>Пакетная выгрузка появится вместе с архивацией проектов</small>
            </span>
          </div>
          {clips.length ? (
            <div className="result-clip-grid">
              {clips.map((clip) => (
                <Card className="result-clip gap-0 py-0" key={clip.id}>
                  <MediaThumb
                    className="result-clip__media"
                    src={sourceInfo?.thumbnailUrl ?? undefined}
                    alt={clip.title}
                    aspect="9:16"
                    tone="ink"
                  >
                    <StatusBadge tone={clip.status === "ready" ? "success" : clip.status === "failed" ? "danger" : "accent"}>
                      <AppIcon icon={clip.status === "ready" ? Tick02Icon : clip.status === "failed" ? Alert02Icon : SparklesIcon} size="sm" aria-hidden="true" />
                      {clip.status === "ready" ? "Готово" : clip.status === "failed" ? "Ошибка клипа" : "В очереди"}
                    </StatusBadge>
                    <span className="result-clip__source-label">Кадр исходника</span>
                    <small>{clip.duration}</small>
                  </MediaThumb>
                  <CardContent className="result-clip__content">
                    <CardTitle>{clip.title}</CardTitle>
                    <CardDescription>{clip.topic} · версия {clip.version || "готовится"}</CardDescription>
                    <div className="result-clip__actions">
                    <AsyncButton
                      disabled={clip.status !== "ready" || downloadingClipId === clip.id}
                      loading={downloadingClipId === clip.id}
                      variant="secondary"
                      onClick={() => void downloadClip(clip.id, clip.title)}
                    >
                      {downloadingClipId !== clip.id ? <AppIcon icon={Download02Icon} size="sm" aria-hidden="true" /> : null}
                      MP4
                    </AsyncButton>
                    <Button
                      nativeButton={false}
                      render={<Link href={`/dashboard/projects/${projectId}/clips/${clip.id}`} />}
                      variant="outline"
                      onClick={() => trackApp("clip_editor_open", { projectId, clipId: clip.id })}
                    >
                      Изменить
                    </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="project-empty-results">
              <AppIcon icon={SparklesIcon} size="lg" aria-hidden="true" />
              <SectionTitle>Сначала выберите моменты</SectionTitle>
              <SectionDescription>После запуска здесь будут отдельно появляться готовые клипы.</SectionDescription>
              <AsyncButton onClick={() => setTab("moments")}>Вернуться к моментам</AsyncButton>
            </Card>
          )}
        </section>
      )}

      <Sheet open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <SheetContent side="right" className="transcript-drawer !w-full sm:!max-w-sm">
          <SheetHeader>
            <SheetTitle>Транскрипт</SheetTitle>
            <SheetDescription>Синхронизировано с видео</SheetDescription>
          </SheetHeader>
          <div className="project-sheet__body">
            <p className="transcript-drawer__hint">Отметьте начало и конец по репликам или исправьте написание. Исходная версия сохранится.</p>
            <label className="dash-search transcript-search">
              <AppIcon icon={Search01Icon} size="sm" aria-hidden="true" />
              <span className="sr-only">Найти в транскрипте</span>
              <Input type="search" placeholder="Найти слово или фразу" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {editingTranscript ? (
              <div className="transcript-editor">
                <Textarea
                  rows={14}
                  value={transcriptDraft}
                  onChange={(event) => setTranscriptDraft(event.target.value)}
                />
                <div>
                  <AsyncButton variant="secondary" onClick={() => setEditingTranscript(false)}>Отменить</AsyncButton>
                  <AsyncButton loading={busy} onClick={saveTranscriptRevision}>Сохранить версию</AsyncButton>
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
              <Card className="transcript-lines gap-0 py-0">
                {filteredTranscript.map((line) => (
                  <Button
                    variant="ghost"
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
                  </Button>
                ))}
              </Card>
            )}
          </div>
          <SheetFooter>
            <AsyncButton variant="secondary" onClick={() => setEditingTranscript((value) => !value)}>
              <AppIcon icon={PencilEdit02Icon} size="sm" aria-hidden="true" />
              {editingTranscript ? "Закрыть правку" : "Исправить текст"}
            </AsyncButton>
            <AsyncButton loading={busy} disabled={!boundaryStart || !boundaryEnd} onClick={() => void applyBoundaries()}>
              Применить границы
            </AsyncButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="project-settings-drawer !w-full sm:!max-w-sm">
          <SheetHeader>
            <SheetTitle>Параметры проекта</SheetTitle>
            <SheetDescription>Без повторной транскрипции</SheetDescription>
          </SheetHeader>
          <div className="project-sheet__body">
            <p className="transcript-drawer__hint">Поиск и стиль собраны здесь, а не разбросаны по отдельным вкладкам.</p>

            <section>
              <SectionTitle>Что найти</SectionTitle>
              <Field className="drawer-field">
                <FieldTitle>Задача</FieldTitle>
                <Select value={searchMode} onValueChange={(value) => setSearchMode(value as typeof searchMode)}>
                  <SelectTrigger aria-label="Задача"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tips">Практические советы</SelectItem>
                    <SelectItem value="best">Лучшие моменты</SelectItem>
                    <SelectItem value="opinions">Сильные мнения</SelectItem>
                    <SelectItem value="stories">Истории</SelectItem>
                    <SelectItem value="custom">Свой запрос</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="project-settings-drawer__pair">
                <Field className="drawer-field">
                  <FieldTitle>Количество</FieldTitle>
                  <Select value={searchCount} onValueChange={(value) => value && setSearchCount(value)}>
                    <SelectTrigger aria-label="Количество"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recommended">Рекомендуемое</SelectItem>
                      <SelectItem value="6">Ровно 6</SelectItem>
                      <SelectItem value="8">Ровно 8</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="drawer-field">
                  <FieldTitle>Длительность</FieldTitle>
                  <Select value={searchDuration} onValueChange={(value) => value && setSearchDuration(value)}>
                    <SelectTrigger aria-label="Длительность"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">До 30 сек.</SelectItem>
                      <SelectItem value="medium">30–60 сек.</SelectItem>
                      <SelectItem value="long">60–90 сек.</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </section>

            <section>
              <SectionTitle>Как оформить</SectionTitle>
              <div className="project-drawer-styles">
                {styles.map((style) => (
                  <Button
                    variant={styleId === style.id ? "secondary" : "outline"}
                    className="h-auto min-h-20 flex-col items-start justify-start whitespace-normal"
                    type="button"
                    key={style.id}
                    onClick={() => {
                      setStyleOverride(style.id);
                      setCaptions(style.captions !== "Выключены");
                      setSilence(style.silenceRemoval);
                    }}
                  >
                    <AppIcon icon={SubtitleIcon} size="sm" aria-hidden="true" />
                    <span>{style.name}</span>
                    {styleId === style.id ? <AppIcon icon={Tick02Icon} size="sm" aria-hidden="true" /> : null}
                  </Button>
                ))}
              </div>
              <Field orientation="horizontal" className="project-setting-row">
                <AppIcon icon={SubtitleIcon} aria-hidden="true" />
                <FieldContent>
                  <FieldTitle>Субтитры</FieldTitle>
                  <span>Применить к выбранным клипам</span>
                </FieldContent>
                <Switch checked={captions} aria-label="Субтитры" onCheckedChange={setCaptions} />
              </Field>
              <Field orientation="horizontal" className="project-setting-row">
                <AppIcon icon={MagicWand01Icon} aria-hidden="true" />
                <FieldContent>
                  <FieldTitle>Удаление пауз</FieldTitle>
                  <span>Не обрезать окончания фраз</span>
                </FieldContent>
                <Switch checked={silence} aria-label="Удаление пауз" onCheckedChange={setSilence} />
              </Field>
            </section>

            <div className="project-warning">
              <AppIcon icon={Alert02Icon} size="sm" aria-hidden="true" />
              <span><strong>Минуты не спишутся повторно.</strong> Новый поиск использует сохранённый транскрипт.</span>
            </div>
          </div>
          <SheetFooter>
            <AsyncButton loading={busy} variant="secondary" onClick={recompute}>
              {!busy ? <AppIcon icon={RotateLeft02Icon} size="sm" aria-hidden="true" /> : null}
              Найти ещё
            </AsyncButton>
            <AsyncButton loading={busy} onClick={() => void applyStyle()}>
              Применить стиль
            </AsyncButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </main>
  );
}
