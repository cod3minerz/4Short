"use client";

import { Button, Input, TextArea } from "@heroui/react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  FileUp,
  Frame,
  Gem,
  History,
  Link2,
  Palette,
  Rocket,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  Twitch,
  UploadCloud,
  WandSparkles,
  Youtube,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type ApiSource,
  ControlApiError,
  createMultipartUpload,
  createProject,
  getYoutubeMetadata,
  isControlApiConfigured,
  listSources,
} from "../lib/control-api";
import { sourceLibrary } from "../data";
import { layoutOptions, layoutToApi } from "../lib/layout-options";
import { trackApp } from "../lib/track-app";
import { useProjectProcessing } from "../lib/use-project-processing";
import { refreshBalance, useDashboardStore } from "../store";
import type { ClipLayout } from "../types";
import { Dialog } from "./ui/Dialog";
import { InfoPanel } from "./ui/InfoPanel";
import { LockedField } from "./ui/LockedField";
import { MediaThumb } from "./ui/MediaThumb";
import { OptionCard } from "./ui/OptionCard";
import { ProcessingCard } from "./ui/ProcessingCard";
import { RangeTimeline } from "./ui/RangeTimeline";
import { SegmentedControl } from "./ui/SegmentedControl";
import { Select } from "./ui/Select";
import { Stepper } from "./ui/Stepper";
import { SubtitlePreviewOverlay } from "./ui/SubtitlePreviewOverlay";
import { Switch } from "./ui/Switch";
import { ValueBadge } from "./ui/ValueBadge";

/**
 * Every host the worker will actually import from — mirrors
 * SUPPORTED_SOURCE_HOSTS in packages/contracts/src/api.ts and the whitelist
 * in services/media-worker/src/fourshort_worker/stages.py. Only these get
 * shown as supported platforms; see backend-capability-map before adding more.
 */
const SUPPORTED_PLATFORMS = [
  { host: "youtube.com", altHost: "youtu.be", label: "YouTube", icon: Youtube },
  { host: "vk.com", altHost: "vkvideo.ru", label: "VK Видео", icon: Clapperboard },
  { host: "rutube.ru", altHost: null, label: "RuTube", icon: Clapperboard },
  { host: "twitch.tv", altHost: "clips.twitch.tv", label: "Twitch", icon: Twitch },
] as const;

function detectPlatform(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return SUPPORTED_PLATFORMS.find(
      (platform) => hostname === platform.host || hostname.endsWith(`.${platform.host}`)
        || (platform.altHost && (hostname === platform.altHost || hostname.endsWith(`.${platform.altHost}`))),
    ) ?? null;
  } catch {
    return null;
  }
}

/** Sub-flavors of "Умная нарезка" — refinements of the AI mode, not siblings of it. */
const aiIntents = [
  { id: "best", title: "Лучшие моменты", text: "Сбалансированный выбор сильных самостоятельных фрагментов." },
  { id: "opinions", title: "Сильные мнения", text: "Яркие позиции, споры и выводы, которые вызывают реакцию." },
  { id: "tips", title: "Практические советы", text: "Пошаговые рекомендации и мысли, которые можно применить." },
  { id: "stories", title: "Истории", text: "Законченные случаи, примеры и личный опыт." },
  { id: "qa", title: "Вопросы и ответы", text: "Содержательные ответы гостей и экспертов." },
  { id: "product", title: "Продукт и демонстрация", text: "Возможности, сценарии использования и объяснение пользы." },
  { id: "custom", title: "Свой запрос", text: "Опишите, какие именно моменты нужно найти." },
];

/** Top-level cutting-mode choice: smart AI (with the sub-flavors above), or two simpler modes. */
const cuttingModes = [
  { id: "smart" as const, title: "Умная нарезка", description: "ИИ сам находит законченные мысли", icon: Sparkles },
  { id: "uniform" as const, title: "Простая", description: "Ровные отрезки по всему диапазону", icon: Scissors },
  { id: "manual" as const, title: "Один фрагмент", description: "Точно заданная часть исходника", icon: Frame },
];

const durations = ["до 30 секунд", "30–60 секунд", "60–90 секунд"];

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Reads a local video file's real duration via its own metadata — no
 * upload, no network call, no backend involved. Resolves `null` (never
 * throws) if the browser can't decode the file's metadata (unsupported
 * codec, corrupted file); the wizard just falls back to its existing
 * "по факту длительности" honest-unknown state in that case.
 */
function readLocalVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = url;
  });
}

/**
 * Four stages, shown from the very first screen so the whole path is visible
 * up front: three configuration steps plus the processing/result stage the
 * wizard actually ends on.
 */
const wizardSteps = [
  { label: "Источник", icon: Link2 },
  { label: "Фрагменты", icon: Scissors },
  { label: "Стиль", icon: Palette },
  { label: "Готово", icon: Rocket },
];

export function NewProjectWizard({
  initialSource = "",
  initialUpload = false,
  initialStep = 1,
}: {
  initialSource?: string;
  initialUpload?: boolean;
  initialStep?: number;
}) {
  const router = useRouter();
  const { styles, defaultStyleId, balanceSeconds, storage } = useDashboardStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceLibraryOpen, setSourceLibraryOpen] = useState(false);
  const [step, setStepState] = useState(Math.min(3, Math.max(1, initialStep)));
  const [url, setUrl] = useState(initialSource);
  const [sourceReady, setSourceReady] = useState(Boolean(initialSource) || initialUpload);
  const [sourceType, setSourceType] = useState<"url" | "file" | "existing">(initialUpload ? "file" : "url");
  /** Which of the 4 supported platforms the pasted URL matched — drives the icon/label shown, never hardcoded. */
  const [sourcePlatform, setSourcePlatform] = useState<(typeof SUPPORTED_PLATFORMS)[number] | null>(null);
  const [sourceMode, setSourceMode] = useState<"url" | "file">(initialUpload ? "file" : "url");
  const [existingSourceId, setExistingSourceId] = useState<string | null>(null);
  const [existingSourceDuration, setExistingSourceDuration] = useState<string | null>(null);
  const [realSourceLibrary, setRealSourceLibrary] = useState<ApiSource[] | null>(null);
  const [sourceLibraryError, setSourceLibraryError] = useState("");
  const [sourceName, setSourceName] = useState(initialUpload ? "Загруженное видео.mp4" : "");
  const [sourceAuthor, setSourceAuthor] = useState<string | null>(null);
  const [sourceThumbnail, setSourceThumbnail] = useState<string | null>(null);
  const [sourceDurationSeconds, setSourceDurationSeconds] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [trimStartSeconds, setTrimStartSeconds] = useState(0);
  const [trimEndSeconds, setTrimEndSeconds] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [cuttingMode, setCuttingMode] = useState<"smart" | "uniform" | "manual">("smart");
  const [otherModesOpen, setOtherModesOpen] = useState(false);
  const [intent, setIntent] = useState("tips");
  const [customPrompt, setCustomPrompt] = useState("");
  const [duration, setDuration] = useState("30–60 секунд");
  const [count, setCount] = useState("recommended");
  const [styleOverride, setStyleOverride] = useState<string | null>(null);
  const styleId = styleOverride ?? defaultStyleId;
  const [captions, setCaptions] = useState(true);
  const [silence, setSilence] = useState(true);
  const [banner, setBanner] = useState(false);
  const [styleMode, setStyleMode] = useState<"auto" | "custom" | "preset">("auto");
  const [layout, setLayout] = useState<ClipLayout>("auto");
  const [diversity, setDiversity] = useState<"low" | "medium" | "high">("high");
  const [strictness, setStrictness] = useState<"wide" | "balanced" | "strict">("balanced");
  const [allowThoughtCompletion, setAllowThoughtCompletion] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingProjectId, setProcessingProjectId] = useState<string | null>(null);
  const { status: processingStatus, processingIndex, secondsInStage, pollError } = useProjectProcessing(processingProjectId);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [launchError, setLaunchError] = useState("");

  const setStep = (nextStep: number) => {
    const normalized = Math.min(3, Math.max(1, nextStep));
    setStepState(normalized);
    const params = new URLSearchParams(window.location.search);
    params.set("step", String(normalized));
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    trackApp("project_create_start");
    if (initialSource) trackApp("source_probe_complete", { source: "youtube" });
  }, [initialSource]);

  useEffect(() => {
    if (!sourceLibraryOpen || !isControlApiConfigured() || realSourceLibrary !== null) return;
    let cancelled = false;
    listSources().then(
      (response) => { if (!cancelled) setRealSourceLibrary(response.items); },
      (fetchError: unknown) => {
        if (!cancelled) setSourceLibraryError(fetchError instanceof ControlApiError ? fetchError.message : "Не удалось загрузить исходники. Проверьте соединение и попробуйте ещё раз.");
      },
    );
    return () => { cancelled = true; };
  }, [sourceLibraryOpen, realSourceLibrary]);

  const verifyUrl = async () => {
    const trimmed = url.trim();
    const platform = detectPlatform(trimmed);
    if (!platform) {
      setError("Нужна ссылка на YouTube, VK Видео, RuTube или Twitch");
      return;
    }
    setError("");
    setVerifying(true);
    setSourcePlatform(platform);
    trackApp("source_url_submit", { platform: platform.label });
    try {
      if (platform.host === "youtube.com") {
        // Only YouTube has a metadata endpoint (oEmbed) today — see
        // backend-capability-map. Other platforms are accepted and import
        // for real, but their preview is confirmed once processing starts
        // rather than faked here.
        const metadata = await getYoutubeMetadata(trimmed);
        setSourceName(metadata.title ?? trimmed);
        setSourceAuthor(metadata.authorName);
        setSourceThumbnail(metadata.thumbnailUrl);
        setSourceDurationSeconds(metadata.durationSeconds);
      } else {
        setSourceName(trimmed);
        setSourceAuthor(null);
        setSourceThumbnail(null);
        setSourceDurationSeconds(null);
      }
      setSourceType("url");
      setSourceReady(true);
      trackApp("source_probe_complete", { source: platform.label });
    } catch (verifyError) {
      setError(
        verifyError instanceof ControlApiError
          ? verifyError.message
          : "Не удалось проверить ссылку. Попробуйте ещё раз.",
      );
    } finally {
      setVerifying(false);
    }
  };

  const resetSource = () => {
    setSourceReady(false);
    setSourceAuthor(null);
    setSourceThumbnail(null);
    setSourceDurationSeconds(null);
    setSourcePlatform(null);
    setExistingSourceId(null);
    setExistingSourceDuration(null);
    setTrimStartSeconds(0);
    setTrimEndSeconds(null);
    setError("");
  };

  const uploadFile = async (file: File) => {
    if (storage && file.size > storage.availableBytes) {
      setError("Для этого файла не хватает места. Удалите ненужные проекты или увеличьте объём хранилища.");
      return;
    }
    setSourceType("file");
    setSourceMode("file");
    setSourceName(file.name);
    setSourceReady(false);
    setSourceDurationSeconds(null);
    setUploading(true);
    setError("");
    trackApp("source_upload_start", { fileType: file.type });
    // Free, local, no backend/API-key involved: the browser can read a
    // video's real duration from its metadata as soon as the file is
    // picked, without waiting for the upload. Unlike YouTube (where
    // duration needs a paid Data API key we don't configure — see
    // `backend-capability-map`), this costs nothing and is always
    // available, so there's no reason to leave file uploads on the same
    // honest-but-avoidable "по факту длительности" fallback.
    void readLocalVideoDuration(file).then((seconds) => {
      if (seconds !== null) setSourceDurationSeconds(Math.round(seconds));
    });
    try {
      const upload = await createMultipartUpload(file);
      setUploadId(upload.uploadId);
      setSourceReady(true);
      trackApp("source_upload_complete");
    } catch (uploadError) {
      setError(uploadError instanceof ControlApiError ? uploadError.message : "Не удалось загрузить файл. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setUploading(false);
    }
  };

  const chooseStyle = (id: string) => {
    const style = styles.find((item) => item.id === id);
    if (!style) return;
    setStyleOverride(id);
    setCaptions(style.captions !== "Выключены");
    setSilence(style.silenceRemoval);
    setBanner(style.banner);
  };

  const currentStyle = styles.find((style) => style.id === styleId) ?? styles[0];

  const availableCredits = balanceSeconds === null ? null : Math.floor(balanceSeconds / 60);
  const durationRange = duration === "до 30 секунд"
    ? [10, 30]
    : duration === "60–90 секунд" ? [60, 90] : [30, 60];

  // Range the user actually wants processed. Defaults to the whole video; the
  // trim control below narrows it when the balance can't cover everything.
  const effectiveEndSeconds = Math.min(trimEndSeconds ?? sourceDurationSeconds ?? 0, sourceDurationSeconds ?? 0);
  const rangeSeconds = sourceDurationSeconds === null
    ? null
    : Math.max(0, effectiveEndSeconds - trimStartSeconds);

  /** Pure arithmetic, no AI call: charge is the source duration we process, rounded up to the minute. */
  const estimatedCost = rangeSeconds === null ? null : Math.ceil(rangeSeconds / 60);
  const notEnoughCredits = estimatedCost !== null && availableCredits !== null && estimatedCost > availableCredits;

  /** Also arithmetic: how many clips of the chosen length fit into the range. */
  const estimatedClips = rangeSeconds === null
    ? null
    : Math.max(1, Math.round(rangeSeconds / (((durationRange[0] + durationRange[1]) / 2) * 4)));

  const isTrimmed = sourceDurationSeconds !== null
    && (trimStartSeconds > 0 || effectiveEndSeconds < sourceDurationSeconds);

  const launchProject = async () => {
    setLaunchError("");
    if (!isControlApiConfigured()) {
      setLaunchError("Российский control API не подключён. Проект не запущен и кредиты не списаны.");
      return;
    }
    if (!currentStyle?.versionId) {
      setLaunchError("Сначала сохраните выбранный стиль на сервере.");
      return;
    }
    if (sourceType === "file" && !uploadId) {
      setLaunchError("Дождитесь завершения загрузки файла.");
      return;
    }
    if (sourceType === "existing" && !existingSourceId) {
      setLaunchError("Выберите сохранённый исходник.");
      return;
    }
    if (notEnoughCredits) {
      setLaunchError("Кредитов не хватает на весь диапазон. Уменьшите его или добавьте кредиты.");
      return;
    }
    try {
      const response = await createProject({
        title: sourceName,
        source: sourceType === "url"
          ? { kind: "youtube", url }
          : sourceType === "existing"
            ? { kind: "existing", sourceId: existingSourceId! }
            : { kind: "upload", uploadId: uploadId!, originalFileName: sourceName },
        momentSettings: {
          mode: (cuttingMode === "smart" ? intent : cuttingMode) as
            "best" | "opinions" | "tips" | "stories" | "qa" | "product" | "custom" | "uniform" | "manual",
          query: cuttingMode === "smart" && intent === "custom" ? customPrompt : undefined,
          count: count === "recommended" ? "recommended" : Number(count),
          durationMinSeconds: durationRange[0],
          durationMaxSeconds: durationRange[1],
          diversity,
          selectionStrictness: strictness,
          allowThoughtCompletion,
          sourceRange: isTrimmed && sourceDurationSeconds !== null
            ? { startSeconds: trimStartSeconds, endSeconds: effectiveEndSeconds }
            : undefined,
          excludedTopics: [],
        },
        styleVersionId: currentStyle.versionId,
        projectOverrides: { layout: layoutToApi(layout) },
      });
      trackApp("project_settings_complete", { intent, duration, style: styleId });
      trackApp("analysis_start");
      setProcessingProjectId(response.project.id);
      setProcessing(true);
      void refreshBalance();
    } catch (projectError) {
      setLaunchError(projectError instanceof ControlApiError ? projectError.message : "Не удалось создать проект");
    }
  };

  if (processing) {
    return (
      <main className="wizard-processing">
        <Link className="wizard-close-link" href="/dashboard/projects">Проекты</Link>
        {/* The roadmap stays visible here so step 4 is a real destination, not a label. */}
        <Stepper steps={wizardSteps} current={4} />
        <ProcessingCard
          sourceName={sourceName}
          sourceThumbnail={sourceThumbnail}
          status={processingStatus}
          processingIndex={processingIndex}
          secondsInStage={secondsInStage}
          errorMessage={launchError || pollError}
          action={
            processingProjectId
              ? {
                completedHref: `/dashboard/projects/${processingProjectId}`,
                completedLabel: "Проверить моменты",
                fallbackHref: "/dashboard/projects",
                fallbackLabel: "Перейти к проектам",
              }
              : undefined
          }
        />
      </main>
    );
  }

  return (
    <main className="wizard dash-page">
      <header className="wizard-header">
        <div className="wizard-header__intro">
          <h1>Создать нарезку</h1>
          <p>Добавьте исходник, выберите нужные моменты и оформление.</p>
        </div>
        <Stepper steps={wizardSteps} current={step} />
      </header>

      <div className="wizard-body">
        {step === 1 ? (
          <section className="wizard-panel" aria-labelledby="wizard-source-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 1 из 4</span>
              <h1 id="wizard-source-title">Добавьте видео</h1>
              <p>Вставьте ссылку, загрузите файл или используйте сохранённый исходник.</p>
            </div>

            {!sourceReady ? (
              <div className="wizard-source-compact">
                <div className="option-card-grid wizard-source-cards">
                  <OptionCard
                    icon={<UploadCloud size={19} />}
                    title="Загрузить"
                    description="До 10 ГБ"
                    selected={sourceMode === "file"}
                    onSelect={() => { setSourceMode("file"); setError(""); }}
                  />
                  <OptionCard
                    icon={<Link2 size={19} />}
                    title="Ссылка"
                    description="YouTube, VK, RuTube, Twitch"
                    selected={sourceMode === "url"}
                    onSelect={() => { setSourceMode("url"); setError(""); }}
                  />
                  <OptionCard
                    icon={<History size={19} />}
                    title="Мои видео"
                    description="Загруженные ранее"
                    onSelect={() => setSourceLibraryOpen(true)}
                  />
                </div>

                {sourceMode === "url" ? (
                  <div className="wizard-source-pane">
                    <div className="wizard-url-input">
                      <span className="wizard-url-input__icon" aria-hidden="true"><Link2 size={17} /></span>
                      <Input
                        aria-label="Ссылка на видео"
                        className="dash-input"
                        placeholder="Вставьте ссылку на видео…"
                        type="url"
                        value={url}
                        variant="secondary"
                        onChange={(event) => { setUrl(event.target.value); setError(""); }}
                        onKeyDown={(event) => { if (event.key === "Enter") void verifyUrl(); }}
                      />
                      <Button isPending={verifying} onPress={() => void verifyUrl()}>
                        {verifying ? "Проверяем…" : "Проверить"}
                      </Button>
                    </div>
                    <ul className="wizard-platform-row" aria-label="Поддерживаемые площадки">
                      {SUPPORTED_PLATFORMS.map((platform) => (
                        <li key={platform.host}><platform.icon size={15} />{platform.label}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <button
                    className="wizard-source-dropzone"
                    type="button"
                    disabled={Boolean(storage?.blocked)}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (file) void uploadFile(file);
                    }}
                  >
                    <UploadCloud size={24} />
                    <span><strong>{uploading ? "Загружаем видео…" : "Перетащите видео или выберите файл"}</strong><small>MP4, MOV, WebM · до 10 ГБ</small></span>
                    <span className="wizard-file-cta"><FileUp size={17} /> Выбрать видео</span>
                  </button>
                )}

                {storage?.blocked ? (
                  <p className="wizard-storage-warning" role="status">
                    Хранилище заполнено. Освободите место в проектах перед новой загрузкой.
                  </p>
                ) : null}

                {error ? <span className="dash-field-error" role="alert">{error}</span> : null}

                <input
                  ref={fileRef}
                  className="sr-only"
                  type="file"
                  disabled={Boolean(storage?.blocked)}
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file);
                  }}
                />

                <Dialog
                  isOpen={sourceLibraryOpen}
                  onOpenChange={setSourceLibraryOpen}
                  title="Прошлые исходники"
                  description="Повторная загрузка и списание кредитов не нужны."
                >
                  {isControlApiConfigured() ? (
                    realSourceLibrary === null ? (
                      sourceLibraryError
                        ? <span className="dash-field-error" role="alert">{sourceLibraryError}</span>
                        : <p className="dash-empty-note">Загружаем исходники…</p>
                    ) : realSourceLibrary.length ? (
                      <div className="wizard-source-library">
                        {realSourceLibrary.map((source) => {
                          const title = typeof source.metadata.originalFileName === "string"
                            ? source.metadata.originalFileName
                            : source.kind === "youtube" ? "Видео с YouTube" : "Загруженное видео";
                          const durationLabel = source.durationMs ? formatDuration(Math.round(source.durationMs / 1000)) : "—";
                          return (
                            <button
                              type="button"
                              key={source.id}
                              onClick={() => {
                                setSourceType("existing");
                                setExistingSourceId(source.id);
                                setExistingSourceDuration(durationLabel);
                                setSourceName(title);
                                setSourceReady(true);
                                setSourceLibraryOpen(false);
                                trackApp("source_reuse", { sourceId: source.id });
                              }}
                            >
                              <span><strong>{title}</strong><small>{source.kind === "youtube" ? "YouTube" : "Файл"} · {durationLabel}</small></span>
                              <ArrowRight size={16} />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="dash-empty-note">Прошлых исходников пока нет — они появятся здесь после первой обработки.</p>
                    )
                  ) : (
                    <div className="wizard-source-library">
                      {sourceLibrary.map((source) => (
                        <button
                          type="button"
                          key={source.id}
                          onClick={() => {
                            setSourceType("existing");
                            setExistingSourceId(source.id);
                            setExistingSourceDuration(source.duration);
                            setSourceName(source.title);
                            setSourceReady(true);
                            setSourceLibraryOpen(false);
                            trackApp("source_reuse", { sourceId: source.id });
                          }}
                        >
                          <span><strong>{source.title}</strong><small>{source.source} · {source.duration}</small></span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                </Dialog>
              </div>
            ) : (
              <div className="wizard-source-ready">
                <MediaThumb
                  className="wizard-source-ready__media"
                  src={sourceThumbnail ?? undefined}
                  alt={sourceName}
                >
                  <span className="wizard-source-ready__kind">
                    {sourceType === "url"
                      ? (sourcePlatform ? <sourcePlatform.icon size={17} /> : <Link2 size={17} />)
                      : sourceType === "existing" ? <History size={17} /> : <FileUp size={17} />}
                  </span>
                </MediaThumb>
                <div className="wizard-source-ready__info">
                  <span className="dash-status tone-success"><Check size={14} /> Это видео?</span>
                  <h2>{sourceName}</h2>
                  {sourceAuthor ? <p className="wizard-source-ready__author">{sourceAuthor}</p> : null}
                  <dl>
                    <div>
                      <dt>Источник</dt>
                      <dd>{sourceType === "url" ? (sourcePlatform?.label ?? "Ссылка") : sourceType === "existing" ? "Медиатека" : "Файл загружен"}</dd>
                    </div>
                    <div>
                      <dt>Длительность</dt>
                      <dd>
                        {sourceType === "existing"
                          ? existingSourceDuration
                          : sourceDurationSeconds !== null
                            ? formatDuration(sourceDurationSeconds)
                            : "Определим при обработке"}
                      </dd>
                    </div>
                    <div>
                      <dt>Результат</dt>
                      <dd>{estimatedClips === null ? "Определим после анализа" : `≈ ${estimatedClips}–${estimatedClips + 2} клипов`}</dd>
                    </div>
                    <div>
                      <dt>Списание</dt>
                      <dd>
                        {sourceType === "existing"
                          ? "Исходник уже оплачен"
                          : estimatedCost === null
                            ? "По фактической длительности"
                            : `≈ ${estimatedCost} кред.`}
                      </dd>
                    </div>
                    <div>
                      <dt>Останется</dt>
                      <dd>
                        {sourceType === "existing"
                          ? availableCredits === null ? "—" : `${availableCredits} мин.`
                          : estimatedCost === null || availableCredits === null
                            ? "После проверки"
                            : `${Math.max(0, availableCredits - estimatedCost)} мин.`}
                      </dd>
                    </div>
                  </dl>
                  <button type="button" onClick={resetSource}>Выбрать другое видео</button>
                </div>
              </div>
            )}

            <div className="wizard-footer wizard-footer--source">
              <Button isDisabled={!sourceReady} onPress={() => setStep(2)}>
                Продолжить
                <ArrowRight size={18} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="wizard-panel" aria-labelledby="wizard-intent-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 2 из 4</span>
              <h1 id="wizard-intent-title">Что нужно найти</h1>
              <p>Выберите задачу — детали можно уточнить позже.</p>
            </div>

            <div className="wizard-section">
              <h2 className="wizard-section__title">Режим нарезки</h2>
              <OptionCard
                icon={<Sparkles size={19} />}
                title="Умная нарезка"
                description="ИИ сам находит законченные мысли и держит спикеров в кадре"
                badge={<ValueBadge>Рекомендуем</ValueBadge>}
                selected={cuttingMode === "smart"}
                onSelect={() => setCuttingMode("smart")}
              />

              <button
                className="wizard-more-intents"
                type="button"
                aria-expanded={otherModesOpen}
                onClick={() => setOtherModesOpen((value) => !value)}
              >
                Нужен другой тип нарезки?
                <ChevronDown className={otherModesOpen ? "is-open" : ""} size={17} />
              </button>
              {otherModesOpen ? (
                <div className="option-card-grid">
                  {/* "uniform" and "manual" aren't real modes yet: find_moments always
                      runs the same AI search+rerank regardless of mode (confirmed —
                      neither string appears in the worker's pipeline logic), so picking
                      either one would silently produce AI-found moments while claiming
                      even segments or a single exact fragment. Locked until the worker
                      gets real mode-specific handling. */}
                  {cuttingModes.filter((mode) => mode.id !== "smart").map((mode) => (
                    <LockedField
                      key={mode.id}
                      icon={<mode.icon size={16} />}
                      label={mode.title}
                      reason="Скоро — пока используется умная нарезка"
                    />
                  ))}
                </div>
              ) : null}

              {cuttingMode === "smart" ? (
                <div className="wizard-ai-intents">
                  <span className="wizard-subsection-label">Что именно искать</span>
                  <div className="option-card-grid">
                    {aiIntents.map((item) => (
                      <OptionCard
                        key={item.id}
                        title={item.title}
                        description={item.text}
                        selected={intent === item.id}
                        onSelect={() => setIntent(item.id)}
                      />
                    ))}
                  </div>
                  {intent === "custom" ? (
                    <label className="wizard-custom-prompt">
                      <span>Опишите нужные моменты</span>
                      <TextArea
                        fullWidth
                        maxLength={240}
                        placeholder="Например: найди ответы гостя о запуске продукта и ошибках первой команды"
                        rows={4}
                        value={customPrompt}
                        variant="secondary"
                        onChange={(event) => setCustomPrompt(event.target.value)}
                      />
                      <small>{customPrompt.length} / 240</small>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="wizard-result-settings">
              <fieldset>
                <legend>Количество</legend>
                <SegmentedControl
                  aria-label="Количество клипов"
                  fullWidth
                  value={count}
                  onChange={setCount}
                  options={[
                    { id: "recommended", label: "Рекомендуемое" },
                    { id: "8", label: "Ровно 8" },
                  ]}
                />
              </fieldset>
              <fieldset>
                <legend>Длительность</legend>
                <SegmentedControl
                  aria-label="Длительность клипов"
                  fullWidth
                  value={duration}
                  onChange={setDuration}
                  options={durations.map((value) => ({ id: value, label: value }))}
                />
              </fieldset>
            </div>

            <div className="wizard-section">
              <h2 className="wizard-section__title">Формат видео</h2>
              <p className="wizard-section__hint">
                Подскажите, как выглядит видео — от этого зависит кадрирование под вертикаль.
              </p>
              <div className="option-card-grid">
                {layoutOptions.map(({ id, label, hint, icon: Icon, rendersToday }) => (
                  rendersToday ? (
                    <OptionCard
                      key={id}
                      icon={<Icon size={19} />}
                      title={label}
                      description={hint}
                      selected={layout === id}
                      onSelect={() => setLayout(id)}
                    />
                  ) : (
                    <LockedField key={id} icon={<Icon size={16} />} label={label} reason="Нужен трекинг лица — скоро" />
                  )
                ))}
              </div>
            </div>

            <div className="wizard-cost">
              <div className="wizard-cost__row">
                <span>Спишем за обработку</span>
                <strong>
                  <Gem size={16} />
                  {estimatedCost === null ? "по факту длительности" : `${estimatedCost} кред.`}
                </strong>
              </div>
              <div className="wizard-cost__row wizard-cost__row--muted">
                <span>Ваш баланс</span>
                <strong>{availableCredits === null ? "…" : `${availableCredits} кред.`}</strong>
              </div>

              {sourceDurationSeconds !== null ? (
                <div className="wizard-trim">
                  <div className="wizard-trim__head">
                    <span>Какую часть видео обрабатывать</span>
                    <b>{formatDuration(trimStartSeconds)} — {formatDuration(effectiveEndSeconds)}</b>
                  </div>
                  <RangeTimeline
                    min={0}
                    max={sourceDurationSeconds}
                    start={trimStartSeconds}
                    end={effectiveEndSeconds}
                    minDuration={60}
                    formatTime={formatDuration}
                    onChange={({ start, end }) => {
                      setTrimStartSeconds(Math.round(start));
                      setTrimEndSeconds(Math.round(end));
                    }}
                  />
                  {isTrimmed ? (
                    <button type="button" onClick={() => { setTrimStartSeconds(0); setTrimEndSeconds(null); }}>
                      Вернуть всё видео
                    </button>
                  ) : null}
                </div>
              ) : null}

              {notEnoughCredits ? (
                <InfoPanel tone="warning">
                  Кредитов не хватает на весь диапазон. Сократите его выше или пополните баланс.
                </InfoPanel>
              ) : null}
            </div>

            <button
              className="wizard-advanced-trigger"
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              Дополнительные настройки
              <ChevronDown className={advancedOpen ? "is-open" : ""} size={18} />
            </button>
            {advancedOpen ? (
              <div className="wizard-advanced-grid">
                <label>
                  <span>Разнообразие тем</span>
                  <Select
                    aria-label="Разнообразие тем"
                    fullWidth
                    value={diversity}
                    onChange={(value) => setDiversity(value as typeof diversity)}
                    options={[
                      { id: "high", label: "Высокое" },
                      { id: "medium", label: "Среднее" },
                      { id: "low", label: "Строго по теме" },
                    ]}
                  />
                </label>
                <label>
                  <span>Строгость отбора</span>
                  <Select
                    aria-label="Строгость отбора"
                    fullWidth
                    value={strictness}
                    onChange={(value) => setStrictness(value as typeof strictness)}
                    options={[
                      { id: "wide", label: "Больше вариантов" },
                      { id: "balanced", label: "Сбалансированно" },
                      { id: "strict", label: "Только лучшие" },
                    ]}
                  />
                </label>
                <label>
                  <span>Завершение мысли</span>
                  <Select
                    aria-label="Завершение мысли"
                    fullWidth
                    value={allowThoughtCompletion ? "yes" : "no"}
                    onChange={(value) => setAllowThoughtCompletion(value === "yes")}
                    options={[
                      { id: "yes", label: "Можно немного превысить лимит" },
                      { id: "no", label: "Не превышать лимит" },
                    ]}
                  />
                </label>
              </div>
            ) : null}

            <div className="wizard-footer">
              <button className="wizard-back" type="button" onClick={() => setStep(1)}>Назад</button>
              <Button onPress={() => setStep(3)}>
                Выбрать оформление
                <ArrowRight size={18} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="wizard-panel wizard-panel--style" aria-labelledby="wizard-style-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 3 из 4</span>
              <h1 id="wizard-style-title">Как должны выглядеть клипы</h1>
              <p>Возьмите сохранённый стиль и при необходимости измените детали.</p>
            </div>

            <SegmentedControl
              aria-label="Режим оформления"
              className="wizard-style-mode"
              fullWidth
              value={styleMode}
              onChange={(value) => setStyleMode(value as "auto" | "custom" | "preset")}
              options={[
                { id: "auto", label: <><Sparkles size={17} /> Быстро</> },
                { id: "custom", label: <><SlidersHorizontal size={17} /> Тонкая настройка</> },
                { id: "preset", label: <><Palette size={17} /> Из пресетов</> },
              ]}
            />

            <div className="wizard-style-layout">
              <div
                className="wizard-phone-preview"
                style={{
                  "--preview-bg": currentStyle.colors[0],
                  "--preview-accent": currentStyle.colors[1],
                } as React.CSSProperties}
              >
                <div className="wizard-phone-preview__safe"><span>Безопасная зона</span></div>
                <span className="dash-media-mark">HP</span>
                {captions ? (
                  <SubtitlePreviewOverlay
                    text="ОДНА МЫСЛЬ МОЖЕТ СТАТЬ ЦЕЛЫМ КЛИПОМ"
                    preset={currentStyle.subtitlePreset}
                    fontFamily={currentStyle.fontFamily}
                    position={currentStyle.subtitlePosition}
                    color={currentStyle.colors[0]}
                    activeColor={currentStyle.colors[1]}
                  />
                ) : null}
                {banner ? <div className="wizard-phone-preview__banner">ВАШ БАННЕР</div> : null}
              </div>

              <div className="wizard-style-controls">
                {styleMode === "auto" ? (
                  <InfoPanel
                    tone="accent"
                    bullets={[
                      `Стиль «${currentStyle.name}» — субтитры и кадрирование как в сохранённом пресете`,
                      "Длинные паузы убираются автоматически",
                      "Место под баннер не резервируется",
                    ]}
                  >
                    Рекомендуемые настройки
                  </InfoPanel>
                ) : null}

                {styleMode === "preset" ? (
                  <div className="wizard-style-options">
                    {styles.map((style) => (
                      <button
                        className={styleId === style.id ? "is-selected" : ""}
                        type="button"
                        key={style.id}
                        onClick={() => chooseStyle(style.id)}
                      >
                        <span style={{ background: `linear-gradient(135deg, ${style.colors[0]} 50%, ${style.colors[1]} 50%)` }} />
                        <b>{style.name}</b>
                        <small>{style.captions}</small>
                        {styleId === style.id ? <Check size={17} /> : null}
                      </button>
                    ))}
                    <Link className="wizard-style-options__manage" href="/dashboard/styles">
                      Управление пресетами в разделе «Стили»
                      <ArrowRight size={15} />
                    </Link>
                  </div>
                ) : null}

                {styleMode === "custom" ? (
                  <>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><Frame size={19} /></span>
                        <span>
                          <strong>Кадр</strong>
                          <small>{layoutOptions.find((item) => item.id === layout)?.label} — меняется на шаге «Что нужно найти»</small>
                        </span>
                      </div>
                    </div>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><Subtitles size={19} /></span>
                        <span><strong>Субтитры</strong><small>Стиль можно изменить в готовом клипе</small></span>
                      </div>
                      <Switch checked={captions} aria-label="Добавлять субтитры" onCheckedChange={setCaptions} />
                    </div>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><WandSparkles size={19} /></span>
                        <span><strong>Убрать длинные паузы</strong><small>Мы не обрежем окончания фраз</small></span>
                      </div>
                      <Switch checked={silence} aria-label="Удалять длинные паузы" onCheckedChange={setSilence} />
                    </div>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><UploadCloud size={19} /></span>
                        <span><strong>Место под баннер</strong><small>Оставим область снизу — файл добавите в редакторе клипа</small></span>
                      </div>
                      <Switch checked={banner} aria-label="Оставить место под баннер" onCheckedChange={setBanner} />
                    </div>
                  </>
                ) : null}
              </div>

              <aside className="wizard-summary">
                <span className="dash-eyebrow">Проверка</span>
                <h2>Всё готово к запуску</h2>
                <dl>
                  <div><dt>Источник</dt><dd>{sourceType === "url" ? (sourcePlatform?.label ?? "Ссылка") : sourceType === "existing" ? "Сохранённый исходник" : "Загруженный файл"}</dd></div>
                  <div>
                    <dt>Задача</dt>
                    <dd>{cuttingMode === "smart" ? aiIntents.find((item) => item.id === intent)?.title : cuttingModes.find((item) => item.id === cuttingMode)?.title}</dd>
                  </div>
                  <div><dt>Формат</dt><dd>{layoutOptions.find((item) => item.id === layout)?.label}</dd></div>
                  <div>
                    <dt>Результат</dt>
                    <dd>
                      {count === "recommended"
                        ? estimatedClips === null ? "Подберём сами" : `≈ ${estimatedClips}–${estimatedClips + 2} клипов`
                        : "8 клипов"}
                    </dd>
                  </div>
                  <div><dt>Длительность</dt><dd>{duration}</dd></div>
                  <div><dt>Стиль</dt><dd>{styles.find((style) => style.id === styleId)?.name}</dd></div>
                </dl>
                <div className="wizard-summary__charge">
                  <span>Списание</span>
                  <strong>
                    <Gem size={16} />
                    {sourceType === "existing"
                      ? "0 — исходник уже оплачен"
                      : estimatedCost === null
                        ? "После проверки длительности"
                        : `${estimatedCost} кред.`}
                  </strong>
                  <small>Один исходник оплачивается один раз. Поиск, правки и ререндер — без нового списания.</small>
                </div>
                <Button
                  fullWidth
                  size="lg"
                  isDisabled={notEnoughCredits}
                  onPress={() => void launchProject()}
                >
                  Найти моменты
                  <ArrowRight size={18} />
                </Button>
                {launchError ? <span className="dash-field-error" role="alert">{launchError}</span> : null}
              </aside>
            </div>

            <div className="wizard-footer wizard-footer--style">
              <button className="wizard-back" type="button" onClick={() => setStep(2)}>Назад</button>
              <span>Настройки сохранятся для следующего проекта.</span>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
