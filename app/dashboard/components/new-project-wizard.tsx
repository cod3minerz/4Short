"use client";

import { ArrowDown01Icon, ArrowRight01Icon, CheckmarkCircle01Icon, FileUploadIcon, FlashIcon, FrameIcon, HistoryIcon, Link01Icon, MagicWand01Icon, PaintBoardIcon, RocketIcon, ScissorIcon, SlidersHorizontalIcon, SparklesIcon, SubtitleIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/hashpix/app-icon";
import { AsyncButton } from "@/components/hashpix/async-button";
import { StatusBadge } from "@/components/hashpix/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type ApiSource,
  ControlApiError,
  createMultipartUpload,
  createProject,
  createSourcePreview,
  getSourcePreview,
  isControlApiConfigured,
  listSources,
} from "../lib/control-api";
import { layoutOptions, layoutToApi } from "../lib/layout-options";
import { trackApp } from "../lib/track-app";
import { useProjectProcessing } from "../lib/use-project-processing";
import { refreshBalance, useDashboardStore } from "../store";
import type { ClipLayout } from "../types";
import { LockedField } from "@/components/hashpix/locked-field";
import { MediaThumb } from "@/components/hashpix/media-thumb";
import { PlatformLogo } from "@/components/hashpix/platform-logo";
import { ProcessingCard } from "@/components/hashpix/processing-card";
import { RangeTimeline } from "@/components/hashpix/range-timeline";
import { Stepper } from "@/components/hashpix/stepper";
import { ValueBadge } from "@/components/hashpix/value-badge";
import { PageDescription, PageTitle, SectionDescription, SectionTitle, typographyVariants } from "@/components/hashpix/typography";

/**
 * Every host the worker will actually import from — mirrors
 * SUPPORTED_SOURCE_HOSTS in packages/contracts/src/api.ts and the whitelist
 * in services/media-worker/src/fourshort_worker/stages.py. Only these get
 * shown as supported platforms; see backend-capability-map before adding more.
 */
const SUPPORTED_PLATFORMS = [
  { host: "youtube.com", altHost: "youtu.be", label: "YouTube", logo: "youtube" },
  { host: "vk.com", altHost: "vkvideo.ru", label: "VK Видео", logo: "vk" },
  { host: "rutube.ru", altHost: null, label: "RuTube", logo: "rutube" },
  { host: "twitch.tv", altHost: "clips.twitch.tv", label: "Twitch", logo: "twitch" },
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
  { id: "smart" as const, title: "Умная нарезка", description: "ИИ сам находит законченные мысли", icon: SparklesIcon },
  { id: "uniform" as const, title: "Простая", description: "Ровные отрезки по всему диапазону", icon: ScissorIcon },
  { id: "manual" as const, title: "Один фрагмент", description: "Точно заданная часть исходника", icon: FrameIcon },
];

const durations = ["до 30 секунд", "30–60 секунд", "60–90 секунд"];

/**
 * A real button for each wizard decision. This is intentionally local to the
 * source flow: it keeps the approved product geometry while relying on the
 * canonical registry Button for its control semantics.
 */
function WizardOption({
  icon,
  title,
  description,
  selected,
  disabled,
  badge,
  onSelect,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: ReactNode;
  onSelect?: () => void;
}) {
  return (
    <Button
      variant={selected ? "secondary" : "outline"}
      className="relative h-auto min-h-20 w-full justify-start whitespace-normal px-4 py-3 text-left"
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {icon ? <span className="text-muted-foreground" aria-hidden="true">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">{title}{badge}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </span>
      {selected ? <AppIcon icon={CheckmarkCircle01Icon} size="sm" className="text-primary" aria-hidden="true" /> : null}
    </Button>
  );
}

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
 * Creates a real local poster before multipart upload starts. It is only a
 * temporary browser URL: the worker later persists its own poster artifact
 * for retained sources. A failed frame extraction stays visibly empty.
 */
function createLocalVideoPoster(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
    };
    video.muted = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(Math.max(0.2, video.duration * 0.08), 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context || !canvas.width || !canvas.height) throw new Error("frame unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.82);
        cleanup();
        resolve(image);
      } catch {
        cleanup();
        resolve(null);
      }
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
  { label: "Источник", icon: Link01Icon },
  { label: "Фрагменты", icon: ScissorIcon },
  { label: "Стиль", icon: PaintBoardIcon },
  { label: "Готово", icon: RocketIcon },
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
  const [sourceReady, setSourceReady] = useState(false);
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
  const [sourcePreflightJobId, setSourcePreflightJobId] = useState<string | null>(null);
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
  const { status: processingStatus, processingIndex, secondsInStage, progress: processingProgress, pollError } = useProjectProcessing(processingProjectId);
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
      const created = await createSourcePreview({ url: trimmed });
      let preview = created;
      for (let attempt = 0; preview.status === "queued" || preview.status === "leased"; attempt += 1) {
        if (attempt >= 45) throw new Error("Проверка ссылки занимает больше минуты. Попробуйте ещё раз.");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        preview = await getSourcePreview(created.id);
      }
      if (preview.status !== "succeeded" || !preview.result) {
        throw new ControlApiError(preview.error?.message ?? "Не удалось получить данные видео", 422, preview.error?.code);
      }
      setSourceName(preview.result.title);
      setSourceAuthor(preview.result.authorName);
      setSourceThumbnail(preview.result.thumbnailUrl);
      setSourceDurationSeconds(preview.result.durationSeconds);
      setSourcePreflightJobId(preview.id);
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
    setSourcePreflightJobId(null);
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
    // This only makes the picked file feel immediate. The server probes the
    // uploaded object before Continue becomes available: duration and balance
    // are never trusted from the browser.
    void Promise.all([readLocalVideoDuration(file), createLocalVideoPoster(file)]).then(([seconds, poster]) => {
      if (seconds !== null) setSourceDurationSeconds(Math.round(seconds));
      if (poster) setSourceThumbnail(poster);
    });
    try {
      const upload = await createMultipartUpload(file);
      setUploadId(upload.uploadId);
      const created = await createSourcePreview({ sourceId: upload.sourceId });
      let preview = created;
      for (let attempt = 0; preview.status === "queued" || preview.status === "leased"; attempt += 1) {
        if (attempt >= 45) throw new Error("Проверка файла занимает больше минуты. Попробуйте ещё раз.");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        preview = await getSourcePreview(created.id);
      }
      if (preview.status !== "succeeded" || !preview.result) {
        throw new ControlApiError(preview.error?.message ?? "Не удалось проверить файл", 422, preview.error?.code);
      }
      setSourceDurationSeconds(preview.result.durationSeconds);
      setSourcePreflightJobId(preview.id);
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
  // An already processed source is charged once per workspace. Its selected
  // range still constrains the next search, but reopening it never creates a
  // second minutes charge.
  const sourceNeedsCharge = sourceType !== "existing";
  const estimatedCost = rangeSeconds === null ? null : sourceNeedsCharge ? Math.ceil(rangeSeconds / 60) : 0;
  const notEnoughCredits = estimatedCost !== null && availableCredits !== null && estimatedCost > availableCredits;
  // Reused sources still need a known duration: the first processing pass may
  // already be paid, but a selected range must never enter the pipeline with
  // an unknown boundary or an unverified credit check.
  // Launching a new source without a known balance would turn an exact quote
  // into a best guess. Reused sources do not spend minutes again, but every
  // new source must have both a measured range and an available balance before
  // the user can proceed.
  const sourceCostKnown = sourceDurationSeconds !== null
    && (!sourceNeedsCharge || availableCredits !== null);

  /** Also arithmetic: how many clips of the chosen length fit into the range. */
  const estimatedClips = rangeSeconds === null
    ? null
    : Math.max(1, Math.round(rangeSeconds / (((durationRange[0] + durationRange[1]) / 2) * 4)));

  const isTrimmed = sourceDurationSeconds !== null
    && (trimStartSeconds > 0 || effectiveEndSeconds < sourceDurationSeconds);

  const launchProject = async () => {
    setLaunchError("");
    if (!isControlApiConfigured()) {
      setLaunchError("Control API не подключён. Проект не запущен и минуты не списаны.");
      return;
    }
    if (!currentStyle?.versionId) {
      setLaunchError("Сначала сохраните выбранный стиль на сервере.");
      return;
    }
    if (sourceType === "file" && (!uploadId || !sourcePreflightJobId)) {
      setLaunchError("Дождитесь завершения загрузки и проверки файла.");
      return;
    }
    if (sourceType === "existing" && !existingSourceId) {
      setLaunchError("Выберите сохранённый исходник.");
      return;
    }
    if (sourceType === "url" && !sourcePreflightJobId) {
      setLaunchError("Сначала дождитесь проверки ссылки.");
      return;
    }
    if (!sourceCostKnown) {
      setLaunchError("Сначала нужно определить длительность видео, чтобы точно посчитать списание.");
      return;
    }
    if (notEnoughCredits) {
      setLaunchError("Минут не хватает на весь диапазон. Уменьшите его или пополните баланс.");
      return;
    }
    try {
      const response = await createProject({
        title: sourceName,
        source: sourceType === "url"
          ? { kind: "youtube", url, preflightJobId: sourcePreflightJobId! }
          : sourceType === "existing"
            ? { kind: "existing", sourceId: existingSourceId! }
            : { kind: "upload", uploadId: uploadId!, originalFileName: sourceName, preflightJobId: sourcePreflightJobId! },
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
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <Button nativeButton={false} render={<Link href="/dashboard/projects" />} className="w-fit" variant="ghost">Проекты</Button>
        {/* The roadmap stays visible here so step 4 is a real destination, not a label. */}
        <Stepper className="mx-auto max-w-2xl" steps={wizardSteps} current={4} />
        <ProcessingCard
          sourceName={sourceName}
          sourceThumbnail={sourceThumbnail}
          status={processingStatus}
          processingIndex={processingIndex}
          secondsInStage={secondsInStage}
          progress={processingProgress}
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
      <section className="wizard-frame">
        <header className="wizard-header">
          <div className="wizard-header__top">
            <div className="wizard-header__intro">
              <PageTitle>Создать нарезку</PageTitle>
              <PageDescription>Добавьте видео и настройте будущие клипы.</PageDescription>
            </div>
            <StatusBadge tone="neutral">Шаг {step} из 4</StatusBadge>
          </div>
          <Stepper steps={wizardSteps} current={step} />
        </header>

        <div className="wizard-body">
          {step === 1 ? (
          <section className="wizard-panel wizard-panel--source" aria-labelledby="wizard-source-title">
            <div className="wizard-panel__heading">
              <SectionTitle id="wizard-source-title">Добавьте видео</SectionTitle>
              <SectionDescription>Выберите источник видео.</SectionDescription>
            </div>

            {!sourceReady ? (
              <div className="wizard-source-compact">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <WizardOption
                    icon={<AppIcon icon={Upload01Icon} size="md" />}
                    title="Загрузить"
                    description="До 10 ГБ"
                    selected={sourceMode === "file"}
                    onSelect={() => { setSourceMode("file"); setError(""); }}
                  />
                  <WizardOption
                    icon={<AppIcon icon={Link01Icon} size="md" />}
                    title="Ссылка"
                    description="YouTube, VK Видео, RuTube, Twitch"
                    selected={sourceMode === "url"}
                    onSelect={() => { setSourceMode("url"); setError(""); }}
                  />
                  <WizardOption
                    icon={<AppIcon icon={HistoryIcon} size="md" />}
                    title="Мои видео"
                    description="Загруженные ранее"
                    onSelect={() => setSourceLibraryOpen(true)}
                  />
                </div>

                {sourceMode === "url" ? (
                  <Card>
                    <CardContent className="space-y-4 pt-6">
                      <Field>
                        <FieldLabel htmlFor="source-url">Ссылка на видео</FieldLabel>
                        <div className="flex gap-2">
                          <div className="relative min-w-0 flex-1"><AppIcon icon={Link01Icon} size="sm" className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground" aria-hidden="true" /><Input id="source-url" className="pl-9" placeholder="Вставьте ссылку на видео…" type="url" value={url} aria-invalid={Boolean(error)} onChange={(event) => { setUrl(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void verifyUrl(); }} /></div>
                          <AsyncButton loading={verifying} onClick={() => void verifyUrl()}>Проверить</AsyncButton>
                        </div>
                        {error ? <FieldError role="alert">{error}</FieldError> : null}
                      </Field>
                      <FieldDescription>Поддерживаемые площадки</FieldDescription>
                      <ul className="flex flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground" aria-label="Поддерживаемые площадки">
                        {SUPPORTED_PLATFORMS.map((platform) => <li className="flex items-center gap-1.5" key={platform.host}><PlatformLogo name={platform.logo} />{platform.label}</li>)}
                      </ul>
                    </CardContent>
                  </Card>
                ) : (
                  <Button
                    variant="outline"
                    className="h-auto w-full justify-start px-4 py-5 text-left"
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
                    <AppIcon icon={Upload01Icon} size="lg" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-sm font-medium">{uploading ? "Загружаем видео…" : "Перетащите видео или выберите файл"}</span><span className="text-xs text-muted-foreground">MP4, MOV, WebM · до 10 ГБ</span></span>
                    <span className={typographyVariants({ role: "label" })}><AppIcon icon={FileUploadIcon} size="sm" aria-hidden="true" /> Выбрать видео</span>
                  </Button>
                )}

                {storage?.blocked ? (
                  <p className="wizard-storage-warning" role="status">
                    Хранилище заполнено. Освободите место в проектах перед новой загрузкой.
                  </p>
                ) : null}

                {sourceMode === "file" && error ? <FieldError role="alert">{error}</FieldError> : null}

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

                <Dialog open={sourceLibraryOpen} onOpenChange={setSourceLibraryOpen}>
                  <DialogContent className="wizard-source-dialog">
                    <DialogHeader><DialogTitle>Прошлые исходники</DialogTitle><DialogDescription>Повторная загрузка и списание минут не нужны.</DialogDescription></DialogHeader>
                  {isControlApiConfigured() ? (
                    realSourceLibrary === null ? (
                      sourceLibraryError
                        ? <FieldError role="alert">{sourceLibraryError}</FieldError>
                        : <p className={typographyVariants({ role: "muted" })}>Загружаем исходники…</p>
                    ) : realSourceLibrary.length ? (
                      <div className="grid max-h-[46dvh] gap-2 overflow-y-auto">
                        {realSourceLibrary.map((source) => {
                          const title = typeof source.metadata.originalFileName === "string"
                            ? source.metadata.originalFileName
                            : source.kind === "youtube" ? "Видео с YouTube" : "Загруженное видео";
                          const durationLabel = source.durationMs ? formatDuration(Math.round(source.durationMs / 1000)) : "—";
                          return (
                            <Button
                              variant="outline"
                              className="h-auto w-full justify-start px-3 py-2 text-left"
                              type="button"
                              key={source.id}
                              onClick={() => {
                                setSourceType("existing");
                                setExistingSourceId(source.id);
                                setExistingSourceDuration(durationLabel);
                                setSourceName(title);
                                setSourceThumbnail(typeof source.metadata.thumbnailUrl === "string" ? source.metadata.thumbnailUrl : null);
                                setSourceDurationSeconds(source.durationMs ? Math.round(source.durationMs / 1000) : null);
                                setSourceReady(true);
                                setSourceLibraryOpen(false);
                                trackApp("source_reuse", { sourceId: source.id });
                              }}
                            >
                              <MediaThumb
                                src={typeof source.metadata.thumbnailUrl === "string" ? source.metadata.thumbnailUrl : undefined}
                                alt=""
                                className="w-18 shrink-0"
                              />
                              <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="truncate text-sm font-medium">{title}</span><span className="text-xs text-muted-foreground">{source.kind === "youtube" ? "YouTube" : "Файл"} · {durationLabel}</span></span>
                              <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={typographyVariants({ role: "muted" })}>Прошлых исходников пока нет — они появятся здесь после первой обработки.</p>
                    )
                  ) : (
                    <p className={typographyVariants({ role: "muted" })}>
                      Медиатека появится после подключения рабочего API. Мы не показываем демонстрационные исходники вместо ваших видео.
                    </p>
                  )}
                  </DialogContent>
                </Dialog>
              </div>
            ) : (
              <Card className="wizard-source-ready px-(--card-spacing)">
                <MediaThumb
                  className="wizard-source-ready__media"
                  src={sourceThumbnail ?? undefined}
                  alt={sourceName}
                >
                  <span className="wizard-source-ready__kind">
                    {sourceType === "url"
                      ? (sourcePlatform ? <PlatformLogo name={sourcePlatform.logo} /> : <AppIcon icon={Link01Icon} size="sm" />)
                      : sourceType === "existing" ? <AppIcon icon={HistoryIcon} size="sm" /> : <AppIcon icon={FileUploadIcon} size="sm" />}
                  </span>
                </MediaThumb>
                <div className="wizard-source-ready__info">
                  <StatusBadge tone="success"><AppIcon icon={CheckmarkCircle01Icon} size="sm" aria-hidden="true" />Источник готов</StatusBadge>
                  <SectionTitle>{sourceName}</SectionTitle>
                  {sourceAuthor ? <p className="wizard-source-ready__author">{sourceAuthor}</p> : null}
                  <dl className="wizard-source-ready__facts">
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
                            : "Определяем длительность"}
                      </dd>
                    </div>
                    <div>
                      <dt>К обработке</dt>
                      <dd>
                        {rangeSeconds === null ? "Определяем диапазон" : formatDuration(rangeSeconds)}
                      </dd>
                    </div>
                    <div>
                      <dt>Списание</dt>
                      <dd>{estimatedCost === null ? "Определяем" : sourceNeedsCharge ? `${estimatedCost} мин.` : "Не требуется"}</dd>
                    </div>
                    <div>
                      <dt>Баланс после запуска</dt>
                      <dd>
                        {estimatedCost === null || availableCredits === null
                            ? "—"
                            : `${Math.max(0, availableCredits - estimatedCost)} мин.`}
                      </dd>
                    </div>
                  </dl>
                  <Button variant="ghost" type="button" onClick={resetSource}>Выбрать другое видео</Button>
                </div>
              </Card>
            )}

            <div className="wizard-footer wizard-footer--source">
              <div className="wizard-footer__source-state" role="status">
                {sourceReady ? <AppIcon icon={CheckmarkCircle01Icon} size="md" aria-hidden="true" /> : <span className="wizard-footer__source-mark" aria-hidden="true" />}
                <span>
                  <strong>{sourceReady ? "Видео добавлено" : "Видео не добавлено"}</strong>
                  <small>{sourceReady ? "Проверьте исходник перед продолжением." : "Добавьте видео, чтобы продолжить."}</small>
                </span>
              </div>
              <AsyncButton size="lg" disabled={!sourceReady || !sourceCostKnown} onClick={() => setStep(2)}>
                Продолжить
                <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
              </AsyncButton>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="wizard-panel" aria-labelledby="wizard-intent-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 2 из 4</span>
              <SectionTitle id="wizard-intent-title">Что нужно найти</SectionTitle>
              <SectionDescription>Выберите задачу — детали можно уточнить позже.</SectionDescription>
            </div>

            <div className="wizard-section">
              <SectionTitle>Режим нарезки</SectionTitle>
              <WizardOption
                icon={<AppIcon icon={SparklesIcon} size="md" />}
                title="Умная нарезка"
                description="ИИ сам находит законченные мысли и держит спикеров в кадре"
                badge={<ValueBadge>Рекомендуем</ValueBadge>}
                selected={cuttingMode === "smart"}
                onSelect={() => setCuttingMode("smart")}
              />

              <Button
                variant="ghost"
                className="wizard-more-intents"
                aria-expanded={otherModesOpen}
                onClick={() => setOtherModesOpen((value) => !value)}
              >
                Нужен другой тип нарезки?
                <AppIcon icon={ArrowDown01Icon} size="sm" className={otherModesOpen ? "is-open" : ""} aria-hidden="true" />
              </Button>
              {otherModesOpen ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {/* "uniform" and "manual" aren't real modes yet: find_moments always
                      runs the same AI search+rerank regardless of mode (confirmed —
                      neither string appears in the worker's pipeline logic), so picking
                      either one would silently produce AI-found moments while claiming
                      even segments or a single exact fragment. Locked until the worker
                      gets real mode-specific handling. */}
                  {cuttingModes.filter((mode) => mode.id !== "smart").map((mode) => (
                    <LockedField
                      key={mode.id}
                      icon={<AppIcon icon={mode.icon} size="sm" />}
                      label={mode.title}
                      reason="Скоро — пока используется умная нарезка"
                    />
                  ))}
                </div>
              ) : null}

              {cuttingMode === "smart" ? (
                <div className="wizard-ai-intents">
                  <span className="wizard-subsection-label">Что именно искать</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {aiIntents.map((item) => (
                      <WizardOption
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
                      <Textarea
                        maxLength={240}
                        placeholder="Например: найди ответы гостя о запуске продукта и ошибках первой команды"
                        rows={4}
                        value={customPrompt}
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
                <ToggleGroup aria-label="Количество клипов" className="w-full" value={[count]} onValueChange={(next) => { if (next[0]) setCount(next[0] as typeof count); }} variant="outline" spacing={0}>
                  <ToggleGroupItem className="flex-1" value="recommended">Рекомендуемое</ToggleGroupItem>
                  <ToggleGroupItem className="flex-1" value="8">Ровно 8</ToggleGroupItem>
                </ToggleGroup>
              </fieldset>
              <fieldset>
                <legend>Длительность</legend>
                <ToggleGroup aria-label="Длительность клипов" className="w-full" value={[duration]} onValueChange={(next) => { if (next[0]) setDuration(next[0] as typeof duration); }} variant="outline" spacing={0}>
                  {durations.map((value) => <ToggleGroupItem className="flex-1" key={value} value={value}>{value}</ToggleGroupItem>)}
                </ToggleGroup>
              </fieldset>
            </div>

            <div className="wizard-section">
              <SectionTitle>Формат видео</SectionTitle>
              <SectionDescription className="mb-3">
                Подскажите, как выглядит видео — от этого зависит кадрирование под вертикаль.
              </SectionDescription>
              <div className="grid gap-2 sm:grid-cols-2">
                {layoutOptions.map(({ id, label, hint, icon, rendersToday }) => (
                  rendersToday ? (
                    <WizardOption
                      key={id}
                      icon={<AppIcon icon={icon} size="md" />}
                      title={label}
                      description={hint}
                      selected={layout === id}
                      onSelect={() => setLayout(id)}
                    />
                  ) : (
                    <LockedField key={id} icon={<AppIcon icon={icon} size="sm" />} label={label} reason="Нужен трекинг лица — скоро" />
                  )
                ))}
              </div>
            </div>

            <div className="wizard-cost">
              <div className="wizard-cost__row">
                <span>Спишем за обработку</span>
                <strong>
                  <AppIcon icon={FlashIcon} size="sm" aria-hidden="true" />
                  {estimatedCost === null ? "определяем длительность" : `${estimatedCost} мин.`}
                </strong>
              </div>
              <div className="wizard-cost__row wizard-cost__row--muted">
                <span>Ваш баланс</span>
                <strong>{availableCredits === null ? "…" : `${availableCredits} мин.`}</strong>
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
                    <Button variant="ghost" type="button" onClick={() => { setTrimStartSeconds(0); setTrimEndSeconds(null); }}>
                      Вернуть всё видео
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {notEnoughCredits ? <p className="text-sm text-destructive" role="status">Минут не хватает на весь диапазон. Сократите его выше или пополните баланс.</p> : null}
            </div>

            <Button
              variant="ghost"
              className="wizard-advanced-trigger"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              Дополнительные настройки
              <AppIcon icon={ArrowDown01Icon} size="sm" className={advancedOpen ? "is-open" : ""} aria-hidden="true" />
            </Button>
            {advancedOpen ? (
              <div className="wizard-advanced-grid">
                <Field>
                  <FieldLabel>Разнообразие тем</FieldLabel>
                  <Select value={diversity} onValueChange={(value) => { if (value) setDiversity(value as typeof diversity); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">Высокое</SelectItem><SelectItem value="medium">Среднее</SelectItem><SelectItem value="low">Строго по теме</SelectItem></SelectContent></Select>
                </Field>
                <Field>
                  <FieldLabel>Строгость отбора</FieldLabel>
                  <Select value={strictness} onValueChange={(value) => { if (value) setStrictness(value as typeof strictness); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="wide">Больше вариантов</SelectItem><SelectItem value="balanced">Сбалансированно</SelectItem><SelectItem value="strict">Только лучшие</SelectItem></SelectContent></Select>
                </Field>
                <Field>
                  <FieldLabel>Завершение мысли</FieldLabel>
                  <Select value={allowThoughtCompletion ? "yes" : "no"} onValueChange={(value) => setAllowThoughtCompletion(value === "yes")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">Можно немного превысить лимит</SelectItem><SelectItem value="no">Не превышать лимит</SelectItem></SelectContent></Select>
                </Field>
              </div>
            ) : null}

            <div className="wizard-footer">
              <Button className="wizard-back" variant="ghost" type="button" onClick={() => setStep(1)}>Назад</Button>
              <AsyncButton size="lg" disabled={notEnoughCredits || !sourceCostKnown} onClick={() => setStep(3)}>
                Выбрать оформление
                <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
              </AsyncButton>
              {notEnoughCredits ? <span className="wizard-footer__notice" role="status">Сократите диапазон или пополните баланс.</span> : null}
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="wizard-panel wizard-panel--style" aria-labelledby="wizard-style-title">
            <div className="wizard-panel__heading">
              <span className="dash-eyebrow">Шаг 3 из 4</span>
              <SectionTitle id="wizard-style-title">Как должны выглядеть клипы</SectionTitle>
              <SectionDescription>Возьмите сохранённый стиль и при необходимости измените детали.</SectionDescription>
            </div>

            <ToggleGroup aria-label="Режим оформления" className="w-full" value={[styleMode]} onValueChange={(next) => { if (next[0]) setStyleMode(next[0] as "auto" | "custom" | "preset"); }} variant="outline" spacing={0}>
              <ToggleGroupItem className="flex-1" value="auto"><AppIcon icon={SparklesIcon} size="sm" /> Быстро</ToggleGroupItem>
              <ToggleGroupItem className="flex-1" value="custom"><AppIcon icon={SlidersHorizontalIcon} size="sm" /> Тонкая настройка</ToggleGroupItem>
              <ToggleGroupItem className="flex-1" value="preset"><AppIcon icon={PaintBoardIcon} size="sm" /> Из пресетов</ToggleGroupItem>
            </ToggleGroup>

            <div className="wizard-style-layout">
              <div className="wizard-style-controls">
                {styleMode === "auto" ? (
                  <Card>
                    <CardContent className="space-y-2 pt-6">
                      <p className="text-sm font-medium">Рекомендуемые настройки</p>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        <li>Стиль «{currentStyle.name}» — субтитры и кадрирование как в сохранённом пресете</li>
                        <li>Длинные паузы убираются автоматически</li>
                        <li>Место под баннер не резервируется</li>
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}

                {styleMode === "preset" ? (
                  <div className="wizard-style-options">
                    {styles.map((style) => (
                      <Button
                        variant={styleId === style.id ? "secondary" : "outline"}
                        className={styleId === style.id ? "is-selected" : ""}
                        type="button"
                        key={style.id}
                        onClick={() => chooseStyle(style.id)}
                      >
                        <span className="wizard-style-options__mark" aria-hidden="true"><AppIcon icon={SubtitleIcon} size="sm" /></span>
                        <b>{style.name}</b>
                        <small>{style.captions === "Выключены" ? "Без субтитров" : `${style.captions} · ${style.framing}`}</small>
                        {styleId === style.id ? <AppIcon icon={CheckmarkCircle01Icon} size="sm" aria-hidden="true" /> : null}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {styleMode === "custom" ? (
                  <>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><AppIcon icon={FrameIcon} size="md" /></span>
                        <span>
                          <strong>Кадр</strong>
                          <small>{layoutOptions.find((item) => item.id === layout)?.label} — меняется на шаге «Что нужно найти»</small>
                        </span>
                      </div>
                    </div>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><AppIcon icon={SubtitleIcon} size="md" /></span>
                        <span><strong>Субтитры</strong><small>Стиль можно изменить в готовом клипе</small></span>
                      </div>
                      <Switch checked={captions} aria-label="Добавлять субтитры" onCheckedChange={setCaptions} />
                    </div>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><AppIcon icon={MagicWand01Icon} size="md" /></span>
                        <span><strong>Убрать длинные паузы</strong><small>Мы не обрежем окончания фраз</small></span>
                      </div>
                      <Switch checked={silence} aria-label="Удалять длинные паузы" onCheckedChange={setSilence} />
                    </div>
                    <div className="wizard-control-card">
                      <div>
                        <span className="wizard-control-card__icon"><AppIcon icon={Upload01Icon} size="md" /></span>
                        <span><strong>Место под баннер</strong><small>Оставим область снизу — файл добавите в редакторе клипа</small></span>
                      </div>
                      <Switch checked={banner} aria-label="Оставить место под баннер" onCheckedChange={setBanner} />
                    </div>
                  </>
                ) : null}
              </div>

              <aside className="wizard-summary">
                <span className="dash-eyebrow">Проверка</span>
                <SectionTitle>Всё готово к запуску</SectionTitle>
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
                    <AppIcon icon={FlashIcon} size="sm" aria-hidden="true" />
                    {sourceType === "existing"
                      ? "0 — исходник уже оплачен"
                      : estimatedCost === null
                        ? "После проверки длительности"
                        : `${estimatedCost} мин.`}
                  </strong>
                  <small>Один исходник оплачивается один раз. Поиск, правки и ререндер — без нового списания.</small>
                </div>
                <AsyncButton
                  className="w-full"
                  size="lg"
                  disabled={notEnoughCredits || !sourceCostKnown}
                  onClick={() => void launchProject()}
                >
                  Найти моменты
                  <AppIcon icon={ArrowRight01Icon} size="sm" aria-hidden="true" />
                </AsyncButton>
                {launchError ? <FieldError role="alert">{launchError}</FieldError> : null}
              </aside>
            </div>

            <div className="wizard-footer wizard-footer--style">
              <Button className="wizard-back" variant="ghost" type="button" onClick={() => setStep(2)}>Назад</Button>
              <span>Настройки сохранятся для следующего проекта.</span>
            </div>
          </section>
        ) : null}
        </div>
      </section>
    </main>
  );
}
