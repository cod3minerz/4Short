"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Crop,
  Eye,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Redo2,
  Save,
  Search,
  Sparkles,
  Subtitles,
  Type,
  Undo2,
  Volume2,
  WandSparkles,
  ZoomIn,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultClipEditorState, transcript } from "../data";
import { handleTablistKeyDown } from "../lib/a11y";
import {
  applyEditorDraftCommands,
  commitEditorDraft,
  ControlApiError,
  getClip,
  getClipPlayback,
  getEditorDraft,
  getEditorManifest,
  getTranscript,
  isControlApiConfigured,
  rerenderClip,
  type ApiEditorManifest,
  type ApiEditorDraft,
  updateClip,
} from "../lib/control-api";
import { buildHveDraftSync } from "../lib/hve-draft-sync";
import {
  clearHveDraftRecovery,
  readHveDraftRecovery,
  recoveryMatchesDraft,
  saveHveDraftRecovery,
} from "../lib/hve-draft-recovery";
import {
  enqueueHveOfflineCommandBatch,
  markHveOfflineCommandBatchError,
  offlineBatchMatchesDraft,
  readHveOfflineCommandBatches,
  removeHveOfflineCommandBatch,
} from "../lib/hve-offline-command-queue";
import { layoutFromApi, layoutOptions, layoutToApi } from "../lib/layout-options";
import { toEditorWords, type EditorWord } from "../lib/transcript";
import { ColorField } from "./ui/ColorField";
import { ActionButton, IconButton } from "./ui/ActionButton";
import { Dialog } from "./ui/Dialog";
import { OptionCard } from "./ui/OptionCard";
import { RangeTimeline } from "./ui/RangeTimeline";
import { SampleList } from "./ui/SampleList";
import { SelectableRow } from "./ui/SelectableRow";
import { Select } from "./ui/Select";
import { SubtitlePreviewOverlay } from "./ui/SubtitlePreviewOverlay";
import { Switch } from "./ui/Switch";
import { HveCompositionPreview } from "./HveCompositionPreview";
import { trackApp } from "../lib/track-app";
import {
  resolveHveSequenceFrame,
  resolveHveSequenceStep,
  type HveSequencePoint,
  type TimeMapEntry,
} from "@/packages/contracts/src";
import type { ClipEditorState, SubtitlePreset } from "../types";

type ApplyScope = "clip" | "project" | "style" | "new_style";
type EditorPanel = "text" | "tools" | "properties";
type InspectorSection = "clip" | "frame" | "captions" | "title";
type SourceReviewSequence = {
  documentHash: string;
  outputDurationUs: number;
  timeMap: TimeMapEntry[];
  previewMode: "single_media" | "dual_media_crossfade";
};
type SourceReviewComposition = Extract<ApiEditorManifest["composition"], { status: "ready" }>;

/**
 * One registry feeds both editor rails. Keeping it here avoids mobile and
 * desktop controls drifting into two different sets of available tools.
 */
const editorSections = [
  { id: "clip", icon: WandSparkles, label: "Клип" },
  { id: "frame", icon: Crop, label: "Кадр" },
  { id: "captions", icon: Subtitles, label: "Субтитры" },
  { id: "title", icon: Type, label: "Заголовок" },
] as const satisfies ReadonlyArray<{ id: InspectorSection; icon: typeof WandSparkles; label: string }>;

function EditorSectionTools({
  active,
  onChange,
  compact = false,
}: {
  active: InspectorSection;
  onChange: (section: InspectorSection) => void;
  compact?: boolean;
}) {
  return editorSections.map(({ id, icon: Icon, label }) => compact ? (
    <IconButton
      key={id}
      aria-label={label}
      tooltip={label}
      aria-pressed={active === id}
      className={active === id ? "is-active" : undefined}
      onPress={() => onChange(id)}
    >
      <Icon size={17} />
    </IconButton>
  ) : (
    <ActionButton
      key={id}
      tone="secondary"
      className={active === id ? "is-active" : undefined}
      onPress={() => onChange(id)}
    >
      <Icon size={17} />
      {label}
    </ActionButton>
  ));
}

function isRetryableEditorTransportFailure(error: unknown) {
  // A 409/4xx response is a real product conflict or invalid command, not an
  // unreliable network. Persisting it for automatic retry would hide the
  // conflict and later reapply a user decision without consent.
  if (!(error instanceof ControlApiError)) return true;
  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

/** One undoable unit of editor state. */
type EditorSnapshot = {
  state: ClipEditorState;
  wordEdits: Record<string, string>;
  hiddenWords: string[];
  cutWords: string[];
};

const subtitlePresets: Array<{ id: SubtitlePreset; label: string; group: string }> = [
  { id: "clean", label: "Clean", group: "CLEAN" },
  { id: "minimal_box", label: "Minimal Box", group: "CLEAN" },
  { id: "bold", label: "Bold", group: "ЯРКИЕ" },
  { id: "word_pop", label: "Word Pop", group: "ЯРКИЕ" },
  { id: "active_word", label: "Active Word", group: "АНИМИРОВАННЫЕ" },
  { id: "karaoke", label: "Karaoke", group: "АНИМИРОВАННЫЕ" },
  { id: "speaker_colors", label: "Speaker Colors", group: "АНИМИРОВАННЫЕ" },
];

/** Offline/preview fallback — replaced by the real transcript once it loads. */
const previewWords: EditorWord[] = transcript.flatMap((line, lineIndex) =>
  line.text.split(/\s+/).map((word, wordIndex) => {
    const [minutes, seconds] = line.time.split(":").map(Number);
    const start = minutes * 60 + seconds + wordIndex * 0.42;
    return {
      id: `preview-${lineIndex}:${wordIndex}`,
      segmentId: `preview-${lineIndex}`,
      wordIndex,
      word,
      speaker: line.speaker,
      time: line.time,
      seconds: start,
      endSeconds: start + 0.42,
    };
  }),
);

// Only a font bundled into the media-worker image can be promised in a final
// render. Custom-font ingestion will add choices here only with its own asset
// verification pipeline.
const fontOptions = ["HVE Sans"];

const positionOptions = [
  { id: "top", label: "Сверху" },
  { id: "center", label: "По центру" },
  { id: "bottom", label: "Снизу" },
];

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function subtitleMode(preset: SubtitlePreset) {
  if (preset === "karaoke") return "karaoke";
  if (preset === "word_pop") return "word_by_word";
  if (preset === "active_word") return "active_word";
  return "line";
}

function subtitleApiPreset(preset: SubtitlePreset) {
  return preset;
}

/** Inverse of `subtitleMode`/`subtitleApiPreset`, for hydrating from a saved clip. */
function subtitlePresetFromApi(mode: string, preset: string): SubtitlePreset {
  if (mode === "karaoke") return "karaoke";
  if (mode === "word_by_word") return "word_pop";
  if (mode === "active_word") return "active_word";
  if (preset === "clean" || preset === "bold" || preset === "minimal_box" || preset === "speaker_colors") return preset;
  return "clean";
}

export function ClipEditor({ projectId, clipId }: { projectId: string; clipId: string }) {
  const canUseApi = isControlApiConfigured() && isUuid(projectId) && isUuid(clipId);
  const [state, setState] = useState<ClipEditorState>(defaultClipEditorState);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [wordEdits, setWordEdits] = useState<Record<string, string>>({});
  const [hiddenWords, setHiddenWords] = useState<string[]>([]);
  const [cutWords, setCutWords] = useState<string[]>([]);
  const [wordQuery, setWordQuery] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scope, setScope] = useState<ApplyScope>("clip");
  const [styleName, setStyleName] = useState("Новый стиль");
  const [savedVersion, setSavedVersion] = useState(1);
  const [baseEdl, setBaseEdl] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<EditorPanel | "preview">("preview");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [inspectorSection, setInspectorSection] = useState<InspectorSection>("clip");
  const [uiHidden, setUiHidden] = useState(false);
  const [zoom, setZoom] = useState(75);
  const [safeZonesVisible, setSafeZonesVisible] = useState(true);
  const [editorWords, setEditorWords] = useState<EditorWord[]>(previewWords);
  const [transcriptRevision, setTranscriptRevision] = useState<number | null>(null);
  const [draftStatus, setDraftStatus] = useState<"saved" | "saving" | "changed">("saved");
  const [hveDraft, setHveDraft] = useState<ApiEditorDraft | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement>(null);
  const sequencePointRef = useRef<HveSequencePoint | null>(null);
  const sequenceTransitionRef = useRef(false);
  const sequenceOriginMsRef = useRef<number | null>(null);
  const sequenceDocumentHashRef = useRef<string | null>(null);
  const sourceReviewRetryUsedRef = useRef(false);
  const draftKey = `hashpix:clip-draft:${projectId}:${clipId}`;
  const hveClientId = useRef(`focus-editor-${crypto.randomUUID()}`);
  const hveClientSequence = useRef(0);

  // A final render always wins. Before one exists the editor may play only a
  // verified source/proxy for transcript and source-time review — never a
  // faux composition with decorative overlays.
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [sourceReviewUrl, setSourceReviewUrl] = useState<string | null>(null);
  const [sourceReviewKind, setSourceReviewKind] = useState<"proxy" | "original" | null>(null);
  const [sourceReviewPending, setSourceReviewPending] = useState(false);
  const [sourceReviewReason, setSourceReviewReason] = useState<string | null>(null);
  const [sourceReviewRefreshNonce, setSourceReviewRefreshNonce] = useState(0);
  const [sourceReviewSequence, setSourceReviewSequence] = useState<SourceReviewSequence | null>(null);
  const [sourceReviewComposition, setSourceReviewComposition] = useState<SourceReviewComposition | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const hasSourceSequence = Boolean(sourceReviewUrl && !playbackUrl && sourceReviewSequence);
  // A delayed refresh must never combine a resolved geometry snapshot from
  // one draft with the output clock from another draft.
  const hasCompositionPreview = Boolean(
    hasSourceSequence
    && sourceReviewComposition
    && sourceReviewSequence
    && sourceReviewComposition.documentHash === sourceReviewSequence.documentHash,
  );
  const sourceSequenceDuration = sourceReviewSequence ? sourceReviewSequence.outputDurationUs / 1_000_000 : null;

  // Trim bounds come from the real media when we have it; otherwise from the
  // clip's own range, so the handles are never pinned to hardcoded seconds.
  // A non-contiguous HVE sequence is deliberately review-only here: a dual
  // source-range slider cannot truthfully edit a sequence after pause cuts.
  // Its boundaries are changed by transcript selection instead.
  const timelineMin = 0;
  const timelineMax = hasSourceSequence
    ? sourceSequenceDuration ?? 1
    : mediaDuration ?? Math.max(state.endSeconds + 30, state.startSeconds + 60);
  const timelineStart = hasSourceSequence ? 0 : state.startSeconds;
  const timelineEnd = hasSourceSequence ? sourceSequenceDuration ?? 1 : state.endSeconds;

  const filteredWords = useMemo(
    () => editorWords.filter((item) => item.word.toLowerCase().includes(wordQuery.toLowerCase())),
    [editorWords, wordQuery],
  );
  const activeWord = editorWords.find((item) => item.id === selectedWord) ?? null;

  useEffect(() => {
    trackApp("clip_editor_open", { projectId, clipId });
    if (!canUseApi) return;
    let cancelled = false;
    void getClip(projectId, clipId)
      .then((response) => {
        if (cancelled) return;
        setSavedVersion(response.clip.currentVersion);
        if (response.version?.edl) setBaseEdl(response.version.edl);
        // Legacy clips have only an EDL, so they retain the old local draft
        // fallback. HVE clips must always fetch their authoritative draft
        // identity first: a base-version-only localStorage record is not
        // enough to safely restore a command after another tab changed it.
        const hasHveDocument = Boolean(response.version?.documentV2);
        if (!hasHveDocument) {
          const stored = window.localStorage.getItem(draftKey);
          if (stored) {
            try {
              const draft = JSON.parse(stored) as {
                baseVersion: number;
                state: ClipEditorState;
                wordEdits: Record<string, string>;
                hiddenWords: string[];
                cutWords: string[];
              };
              if (draft.baseVersion === response.clip.currentVersion) {
                setState(draft.state);
                setWordEdits(draft.wordEdits ?? {});
                setHiddenWords(draft.hiddenWords ?? []);
                setCutWords(draft.cutWords ?? []);
                return;
              }
            } catch {
              window.localStorage.removeItem(draftKey);
            }
          }
        } else {
          // An HVE recovery lives in IndexedDB with an exact document hash.
          // Do not allow a stale legacy record to be considered in a future
          // non-HVE fallback after this clip has been migrated.
          window.localStorage.removeItem(draftKey);
        }
        const edl = response.version?.edl as {
          layout?: { mode: string };
          subtitles?: {
            enabled: boolean; mode: string; preset: string;
            fontFamily: string; fontSize: number; position: "top" | "center" | "bottom";
            color: string; activeColor: string;
          };
          title?: unknown;
          silence?: { enabled: boolean };
          export?: { height: number };
        } | undefined;
        setState((current) => ({
          ...current,
          title: response.clip.title,
          socialTitle: response.clip.socialTitle ?? current.socialTitle,
          socialDescription: response.clip.socialDescription ?? current.socialDescription,
          ...(edl?.layout ? { layout: layoutFromApi(edl.layout.mode) } : {}),
          ...(edl?.subtitles ? {
            captionsEnabled: edl.subtitles.enabled,
            subtitlePreset: subtitlePresetFromApi(edl.subtitles.mode, edl.subtitles.preset),
            fontFamily: edl.subtitles.fontFamily,
            fontSize: edl.subtitles.fontSize,
            subtitlePosition: edl.subtitles.position,
            primaryColor: edl.subtitles.color,
            activeColor: edl.subtitles.activeColor,
          } : {}),
          ...(edl?.silence ? { silenceRemoval: edl.silence.enabled } : {}),
          ...(edl?.title ? { titleEnabled: true } : { titleEnabled: false }),
          ...(edl?.export?.height === 1280 || edl?.export?.height === 1920
            ? { exportHeight: edl.export.height }
            : {}),
        }));
        if (response.version?.documentV2) {
          void getEditorDraft(projectId, clipId).then(async ({ draft }) => {
            if (cancelled) return;
            setHveDraft(draft);
            hveClientSequence.current = 0;
            setState((current) => ({
              ...current,
              title: draft.metadata.title,
              socialTitle: draft.metadata.socialTitle ?? "",
              socialDescription: draft.metadata.socialDescription ?? "",
            }));
            setWordEdits(Object.fromEntries(
              (draft.document as { captions?: { words?: Array<{ wordId?: string; displayText?: string }> } }).captions?.words
                ?.flatMap((word) => word.wordId && word.displayText ? [[word.wordId, word.displayText] as const] : []) ?? [],
            ));
            setHiddenWords(
              (draft.document as { captions?: { words?: Array<{ wordId?: string; hidden?: boolean }> } }).captions?.words
                ?.flatMap((word) => word.wordId && word.hidden ? [word.wordId] : []) ?? [],
            );
            setCutWords(
              (draft.document as { captions?: { words?: Array<{ wordId?: string; cutFromMedia?: boolean }> } }).captions?.words
                ?.flatMap((word) => word.wordId && word.cutFromMedia ? [word.wordId] : []) ?? [],
            );
            try {
              const recovery = await readHveDraftRecovery(clipId);
              if (cancelled || !recovery) return;
              if (!recoveryMatchesDraft(recovery, draft)) {
                setNotice("Есть несохранённая правка из другой версии клипа. Она не применена автоматически.");
                return;
              }
              setState(recovery.state);
              setWordEdits(recovery.wordEdits);
              setHiddenWords(recovery.hiddenWords);
              setCutWords(recovery.cutWords);
              setDirty(true);
              setDraftStatus("changed");
              setNotice("Восстановлена несохранённая правка этого клипа.");
            } catch {
              // Recovery is best-effort. A privacy mode or quota error must
              // never prevent opening the authoritative server draft.
            }
          }, (error: unknown) => {
            if (!cancelled) setNotice(error instanceof ControlApiError ? error.message : "Не удалось открыть серверный черновик HVE.");
          });
        }
      })
      .catch((error: unknown) => setNotice(error instanceof ControlApiError ? error.message : "Не удалось загрузить клип. Проверьте соединение и попробуйте ещё раз."));
    return () => {
      cancelled = true;
    };
  }, [canUseApi, clipId, draftKey, projectId]);

  useEffect(() => {
    if (!canUseApi) return;
    let cancelled = false;
    getTranscript(projectId).then(
      (response) => {
        if (cancelled) return;
        setEditorWords(toEditorWords(response.segments));
        setTranscriptRevision(response.transcript.revision);
      },
      // Transcription may not have run yet — keep the placeholder words
      // rather than blanking the panel.
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [canUseApi, projectId]);

  useEffect(() => {
    if (!canUseApi) return;
    let cancelled = false;
    getClipPlayback(projectId, clipId).then(
      (playback) => { if (!cancelled) setPlaybackUrl(playback.url); },
      // 404 simply means the render isn't finished — not an error worth showing.
      () => { if (!cancelled) setPlaybackUrl(null); },
    );
    return () => { cancelled = true; };
  }, [canUseApi, clipId, projectId]);

  // HVE editor manifest signs only a verified browser proxy or an explicitly
  // H.264/AAC-compatible original. Refresh before expiry; a source URL is
  // never persisted in the draft or shown in the interface.
  useEffect(() => {
    if (!canUseApi) return;
    let cancelled = false;
    let refreshTimer: number | undefined;
    const load = async () => {
      try {
        const manifest = await getEditorManifest(projectId, clipId);
        if (cancelled) return;
        if (manifest.sequence.status === "ready") {
          if (sequenceDocumentHashRef.current !== manifest.sequence.documentHash) {
            sequenceDocumentHashRef.current = manifest.sequence.documentHash;
            sequencePointRef.current = null;
            sequenceOriginMsRef.current = null;
            setCurrentTime(0);
          }
          setSourceReviewSequence({
            documentHash: manifest.sequence.documentHash,
            outputDurationUs: manifest.sequence.outputDurationUs,
            timeMap: manifest.sequence.timeMap,
            previewMode: manifest.sequence.previewMode,
          });
        } else {
          sequenceDocumentHashRef.current = null;
          setSourceReviewSequence(null);
          setSourceReviewReason(null);
        }
        if (manifest.composition.status === "ready") {
          setSourceReviewComposition(manifest.composition);
        } else {
          setSourceReviewComposition(null);
        }
        if (manifest.preview.status !== "ready") {
          setSourceReviewUrl(null);
          setSourceReviewKind(null);
          setSourceReviewReason(manifest.preview.reason);
          setSourceReviewPending(true);
          return;
        }
        setSourceReviewUrl(manifest.preview.url);
        setSourceReviewKind(manifest.preview.source);
        if (manifest.sequence.status === "ready") setSourceReviewReason(null);
        setSourceReviewPending(false);
        refreshTimer = window.setTimeout(load, Math.max(60_000, (manifest.preview.expiresIn - 60) * 1_000));
      } catch {
        // The HVE v2 document can legitimately be unavailable while a legacy
        // clip is still opening. The final render endpoint remains usable.
        if (!cancelled) {
          setSourceReviewUrl(null);
          setSourceReviewKind(null);
          setSourceReviewReason(null);
          sequenceDocumentHashRef.current = null;
          setSourceReviewSequence(null);
          setSourceReviewComposition(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [canUseApi, clipId, hveDraft?.documentHash, projectId, sourceReviewRefreshNonce]);

  // A signed source URL may be invalidated before its nominal expiry (for
  // example after a retention transition). Retry exactly once with a fresh
  // manifest. This never touches the editor draft, and a second failure is
  // shown honestly instead of looping a broken private URL forever.
  useEffect(() => {
    sourceReviewRetryUsedRef.current = false;
  }, [clipId, hveDraft?.documentHash, projectId]);

  const retrySourceReviewAfterMediaError = useCallback(() => {
    if (!sourceReviewUrl || playbackUrl) return;
    if (!sourceReviewRetryUsedRef.current) {
      sourceReviewRetryUsedRef.current = true;
      setSourceReviewPending(true);
      setSourceReviewReason(null);
      setSourceReviewRefreshNonce((value) => value + 1);
      return;
    }
    setSourceReviewUrl(null);
    setSourceReviewKind(null);
    setSourceReviewPending(false);
    setSourceReviewReason("source_review_failed");
  }, [playbackUrl, sourceReviewUrl]);

  /**
   * Moves one or two native source elements to the same immutable HVE output
   * clock.  During an explicit pause crossfade both source ranges are active
   * and their native audio is gain-ramped as well as their canvas opacity.
   * This remains a source review: ASS glyph shaping and private production
   * assets still belong to the final worker render.
   */
  const syncSourceReviewFrame = useCallback((outputUs: number, input: { force?: boolean; shouldPlay?: boolean } = {}) => {
    if (!sourceReviewSequence) return null;
    const primary = videoRef.current;
    const secondary = secondaryVideoRef.current;
    if (!primary) return null;
    const frame = resolveHveSequenceFrame(sourceReviewSequence.timeMap, outputUs);
    if (!frame) return null;
    const sync = (video: HTMLVideoElement, point: HveSequencePoint, volume: number, force = false) => {
      video.playbackRate = point.playbackRate;
      video.volume = Math.max(0, Math.min(1, volume));
      const sourceSeconds = point.sourceUs / 1_000_000;
      const drift = Math.abs(video.currentTime - sourceSeconds);
      if (force || !Number.isFinite(video.currentTime) || drift > 0.12) video.currentTime = sourceSeconds;
    };
    if (frame.kind === "crossfade") {
      if (!secondary) return frame;
      const force = Boolean(input.force) || !sequenceTransitionRef.current;
      sync(primary, frame.from, 1 - frame.progress, force);
      sync(secondary, frame.to, frame.progress, force);
      sequenceTransitionRef.current = true;
      sequencePointRef.current = frame.from;
      if (input.shouldPlay) {
        void primary.play().catch(() => setPlaying(false));
        // Both elements have the same authorised source URL.  If a browser
        // refuses the second native play after a user gesture, it stays
        // visually correct but never claims a complete A/V preview.
        void secondary.play().catch(() => setSourceReviewReason("crossfade_audio_unavailable"));
      }
      return frame;
    }

    const previous = sequenceTransitionRef.current ? null : sequencePointRef.current;
    const step = resolveHveSequenceStep({
      timeMap: sourceReviewSequence.timeMap,
      outputUs,
      previous,
      observedSourceUs: Number.isFinite(primary.currentTime) ? Math.round(primary.currentTime * 1_000_000) : null,
    });
    if (step.kind === "ended") return null;
    sync(primary, step.point, 1, Boolean(input.force) || step.kind === "seek" || sequenceTransitionRef.current);
    if (secondary) {
      secondary.pause();
      secondary.volume = 0;
    }
    sequenceTransitionRef.current = false;
    sequencePointRef.current = step.point;
    if (input.shouldPlay) void primary.play().catch(() => setPlaying(false));
    return frame;
  }, [sourceReviewSequence]);

  // Drive the <video> from the editor's play/pause state. An HVE source
  // review starts on its output clock; legacy source review retains a simple
  // contiguous source trim.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      if (hasSourceSequence && sourceReviewSequence) {
        const outputUs = Math.round(Math.min(
          Math.max(0, currentTime),
          sourceReviewSequence.outputDurationUs / 1_000_000,
        ) * 1_000_000);
        const frame = syncSourceReviewFrame(outputUs, { force: true, shouldPlay: true })
          ?? syncSourceReviewFrame(0, { force: true, shouldPlay: true });
        if (frame) {
          sequenceOriginMsRef.current = performance.now() - outputUs / 1_000;
        }
      } else if (!playbackUrl && (video.currentTime < state.startSeconds || video.currentTime >= state.endSeconds)) {
        video.currentTime = state.startSeconds;
      }
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
      secondaryVideoRef.current?.pause();
      sequenceOriginMsRef.current = null;
    }
  }, [currentTime, hasSourceSequence, playbackUrl, playing, sourceReviewSequence, state.endSeconds, state.startSeconds, syncSourceReviewFrame]);

  // Native `timeupdate` is too infrequent to skip a removed pause cleanly.
  // This output clock is fed by the same immutable TimeMap as the worker and
  // performs a source seek only at a proven discontinuity or material drift.
  // It remains source review, not a simulated final visual composition.
  useEffect(() => {
    if (!playing || !hasSourceSequence || !sourceReviewSequence) return;
    const video = videoRef.current;
    if (!video) return;
    let frameId = 0;
    const tick = () => {
      const origin = sequenceOriginMsRef.current ?? performance.now();
      const outputUs = Math.round(Math.max(0, performance.now() - origin) * 1_000);
      const frame = syncSourceReviewFrame(outputUs, { shouldPlay: true });
      if (!frame) {
        setCurrentTime(sourceReviewSequence.outputDurationUs / 1_000_000);
        setPlaying(false);
        return;
      }
      setCurrentTime(outputUs / 1_000_000);
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [hasSourceSequence, playing, sourceReviewSequence, syncSourceReviewFrame]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      // HVE sequence playback owns the output clock. Legacy source review
      // loops inside the selected source range; completed renders already
      // expose output time natively.
      if (hasSourceSequence) return;
      if (!playbackUrl && video.currentTime >= state.endSeconds) {
        video.currentTime = state.startSeconds;
        if (!playing) video.pause();
      }
      setCurrentTime(video.currentTime);
    };
    const onLoaded = () => setMediaDuration(Number.isFinite(video.duration) ? video.duration : null);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onLoaded);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [hasSourceSequence, playing, playbackUrl, state.endSeconds, state.startSeconds]);

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (hasSourceSequence && sourceReviewSequence) {
      const outputUs = Math.round(Math.min(
        Math.max(0, seconds),
        sourceReviewSequence.outputDurationUs / 1_000_000,
      ) * 1_000_000);
      syncSourceReviewFrame(outputUs, { force: true, shouldPlay: playing });
      // Rebase in the animation-frame loop rather than reading the wall
      // clock from the component render closure. That keeps React's render
      // path pure and gives the next frame one authoritative start time.
      sequenceOriginMsRef.current = null;
      setCurrentTime(outputUs / 1_000_000);
      return;
    }
    if (video) video.currentTime = seconds;
    setCurrentTime(seconds);
  };

  useEffect(() => {
    const warnOnLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnOnLeave);
    return () => window.removeEventListener("beforeunload", warnOnLeave);
  }, [dirty]);

  /** Everything undo/redo must restore — transcript edits included. */
  const snapshot = (): EditorSnapshot => ({ state, wordEdits, hiddenWords, cutWords });

  const restore = (entry: EditorSnapshot) => {
    setState(entry.state);
    setWordEdits(entry.wordEdits);
    setHiddenWords(entry.hiddenWords);
    setCutWords(entry.cutWords);
  };

  const pushHistory = () => {
    setPast((history) => [...history.slice(-39), snapshot()]);
    setFuture([]);
    setDirty(true);
    setDraftStatus("changed");
  };

  const commit = (patch: Partial<ClipEditorState>) => {
    pushHistory();
    setState((current) => ({ ...current, ...patch }));
  };

  /**
   * Transcript edits used to call their setters directly, so undo silently
   * skipped hiding, cutting and word rewrites. They go through the same
   * history as every other change now.
   */
  const commitTranscript = (patch: Partial<Omit<EditorSnapshot, "state">>) => {
    pushHistory();
    if (patch.wordEdits) setWordEdits(patch.wordEdits);
    if (patch.hiddenWords) setHiddenWords(patch.hiddenWords);
    if (patch.cutWords) setCutWords(patch.cutWords);
  };

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((history) => [snapshot(), ...history]);
    setPast((history) => history.slice(0, -1));
    restore(previous);
    setDirty(true);
    setDraftStatus("changed");
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((history) => [...history, snapshot()]);
    setFuture((history) => history.slice(1));
    restore(next);
    setDirty(true);
    setDraftStatus("changed");
  };

  const syncHveDraft = useCallback(async () => {
    if (!hveDraft || !canUseApi) return hveDraft;
    // The browser may have lost the response after the API committed a batch.
    // Replay the exact persisted batch first: the API's batch idempotency then
    // either returns that result or applies it once. Never replay a command
    // into a newer document; that is a visible conflict, not a best effort.
    let authoritativeDraft = hveDraft;
    const queuedBatches = await readHveOfflineCommandBatches(clipId);
    for (const batch of queuedBatches) {
      if (!offlineBatchMatchesDraft(batch, authoritativeDraft)) {
        await markHveOfflineCommandBatchError(batch.batchId, "DRAFT_IDENTITY_CHANGED");
        setNotice("Есть офлайн-правка из другой версии клипа. Она не применена автоматически.");
        return null;
      }
      try {
        const replay = await applyEditorDraftCommands(projectId, clipId, {
          batchId: batch.batchId,
          baseRevision: batch.baseRevision,
          commands: batch.commands,
        });
        await removeHveOfflineCommandBatch(batch.batchId);
        authoritativeDraft = replay.draft;
        setHveDraft(replay.draft);
      } catch (error) {
        await markHveOfflineCommandBatchError(
          batch.batchId,
          error instanceof ControlApiError ? error.code ?? error.message : "NETWORK_OR_UNKNOWN_ERROR",
        );
        throw error;
      }
    }

    const result = buildHveDraftSync({
      draft: authoritativeDraft as unknown as Parameters<typeof buildHveDraftSync>[0]["draft"],
      state,
      words: editorWords,
      wordEdits,
      hiddenWords,
      cutWords,
      clientId: hveClientId.current,
      firstSequence: hveClientSequence.current,
      batchId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createCommandId: () => crypto.randomUUID(),
    });
    if (result.unsupported.length) {
      setNotice(result.unsupported.join(" "));
      return null;
    }
    if (!result.commands.length) return authoritativeDraft;
    setDraftStatus("saving");
    const batchId = result.commands[0]!.batchId;
    let response;
    try {
      response = await applyEditorDraftCommands(projectId, clipId, {
        batchId,
        baseRevision: authoritativeDraft.revision,
        commands: result.commands,
      });
    } catch (error) {
      if (!isRetryableEditorTransportFailure(error)) throw error;
      // Keep the exact original batch id for a retry. Generating a new id
      // after an uncertain network failure can apply the same edit twice.
      // Persist the full UI snapshot first, so on reload the user sees the
      // state that produced this command batch before it is retried.
      await saveHveDraftRecovery({
        schemaVersion: 1,
        clipId,
        documentHash: authoritativeDraft.documentHash,
        baseVersion: authoritativeDraft.baseVersion,
        revision: authoritativeDraft.revision,
        state,
        wordEdits,
        hiddenWords,
        cutWords,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      await enqueueHveOfflineCommandBatch({
        schemaVersion: 1,
        batchId,
        clipId,
        baseVersion: authoritativeDraft.baseVersion,
        baseRevision: authoritativeDraft.revision,
        documentHash: authoritativeDraft.documentHash,
        commands: result.commands,
        createdAt: new Date().toISOString(),
        lastError: error instanceof ControlApiError ? error.code ?? error.message : "NETWORK_OR_UNKNOWN_ERROR",
      });
      throw error;
    }
    hveClientSequence.current = result.nextSequence;
    setHveDraft(response.draft);
    setDraftStatus("saved");
    setDirty(false);
    void clearHveDraftRecovery(clipId);
    return response.draft;
  }, [canUseApi, clipId, cutWords, editorWords, hiddenWords, hveDraft, projectId, state, wordEdits]);

  const persistDraft = useCallback(() => {
    if (hveDraft && canUseApi) {
      void syncHveDraft().catch((error: unknown) => {
        setDraftStatus("changed");
        setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить серверный черновик HVE.");
      });
      return;
    }
    setDraftStatus("saving");
    window.localStorage.setItem(draftKey, JSON.stringify({
      clipId,
      baseVersion: savedVersion,
      revision: Date.now(),
      state,
      wordEdits,
      hiddenWords,
      cutWords,
      updatedAt: new Date().toISOString(),
    }));
    setDraftStatus("saved");
  }, [canUseApi, clipId, cutWords, draftKey, hiddenWords, hveDraft, savedVersion, state, syncHveDraft, wordEdits]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(persistDraft, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, persistDraft]);

  useEffect(() => {
    if (!hveDraft || !dirty) return;
    void saveHveDraftRecovery({
      schemaVersion: 1,
      clipId,
      documentHash: hveDraft.documentHash,
      baseVersion: hveDraft.baseVersion,
      revision: hveDraft.revision,
      state,
      wordEdits,
      hiddenWords,
      cutWords,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }, [clipId, cutWords, dirty, hiddenWords, hveDraft, state, wordEdits]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches("input, textarea, select, [contenteditable='true']");
      const mod = event.metaKey || event.ctrlKey;

      if (event.key === " " && !isEditing) {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        persistDraft();
      } else if (mod && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if (event.key === "Escape") {
        setMobilePanel("preview");
      } else if (event.shiftKey && event.key === "\\") {
        event.preventDefault();
        setUiHidden((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const compileEdl = () => {
    if (!baseEdl) return null;
    return {
      ...baseEdl,
      range: { startMs: Math.round(state.startSeconds * 1000), endMs: Math.round(state.endSeconds * 1000) },
      // Transcript revisions address words as (segmentId, wordIndex), so send
      // those rather than only an opaque ref; the revision lets the server
      // detect edits made against a stale transcript.
      transcriptRevision,
      transcriptEdits: editorWords.flatMap((word) => {
        const displayText = wordEdits[word.id];
        const hiddenFromSubtitles = hiddenWords.includes(word.id);
        const cutFromMedia = cutWords.includes(word.id);
        return displayText || hiddenFromSubtitles || cutFromMedia
          ? [{
              wordRef: word.id,
              segmentId: word.segmentId,
              wordIndex: word.wordIndex,
              displayText,
              hiddenFromSubtitles,
              cutFromMedia,
            }]
          : [];
      }),
      layout: layoutToApi(state.layout),
      subtitles: {
        enabled: state.captionsEnabled,
        mode: subtitleMode(state.subtitlePreset),
        preset: subtitleApiPreset(state.subtitlePreset),
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        fontWeight: 800,
        uppercase: false,
        maxWordsPerLine: 5,
        maxLines: 2,
        position: state.subtitlePosition,
        safeMarginPx: 160,
        align: "center",
        color: state.primaryColor,
        activeColor: state.activeColor,
        outlineColor: "#06131a",
        outlinePx: 4,
        shadow: true,
        background: state.subtitlePreset === "minimal_box",
        punctuation: true,
        emoji: false,
        censorWords: [],
      },
      silence: {
        enabled: state.silenceRemoval,
        minimumMs: 800,
        beforePaddingMs: 100,
        afterPaddingMs: 120,
        crossfadeMs: 30,
      },
      export: {
        width: state.exportHeight === 1920 ? 1080 : 720,
        height: state.exportHeight,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        videoBitrateKbps: state.exportHeight === 1920 ? 6500 : 3600,
        audioBitrateKbps: 160,
        watermark: false,
      },
    };
  };

  const saveVersion = async () => {
    setBusy(true);
    try {
      const edl = compileEdl();
      if (hveDraft && canUseApi) {
        const draft = await syncHveDraft();
        if (!draft) return;
        const response = await commitEditorDraft(projectId, clipId, draft.revision);
        setSavedVersion(response.version.version);
        setHveDraft({ ...draft, baseVersion: response.version.version, revision: 0 });
      } else if (canUseApi && edl) {
        const response = await updateClip(projectId, clipId, {
          expectedVersion: savedVersion,
          title: state.title,
          socialTitle: state.socialTitle,
          socialDescription: state.socialDescription,
          edl,
          scope,
          styleName: scope === "new_style" ? styleName : undefined,
        });
        setSavedVersion(response.version.version);
        setBaseEdl(response.version.edl);
      } else {
        setSavedVersion((version) => version + 1);
      }
      setDirty(false);
      window.localStorage.removeItem(draftKey);
      setDraftStatus("saved");
      setScopeOpen(false);
      setNotice(scope === "clip" ? "Версия клипа сохранена." : "Изменения применены в выбранной области.");
      trackApp("clip_version_save", { projectId, clipId, scope });
      trackApp("clip_scope_apply", { scope });
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось сохранить версию. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const runRerender = async () => {
    setBusy(true);
    try {
      if (dirty) {
        await saveVersion();
        // Committing an HVE draft already creates the new immutable version
        // and queues exactly one render. Do not enqueue the legacy rerender
        // command as well.
        if (hveDraft) return;
      }
      if (canUseApi) await rerenderClip(projectId, clipId);
      setNotice("Перерендер запущен только для этого клипа. Минуты исходника не списываются.");
      trackApp("clip_rerender", { projectId, clipId });
    } catch (error) {
      setNotice(error instanceof ControlApiError ? error.message : "Не удалось запустить перерендер. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const setBoundaryFromWord = (edge: "start" | "end") => {
    if (!activeWord) return;
    if (edge === "start") commit({ startSeconds: Math.min(activeWord.seconds, state.endSeconds - 5) });
    else commit({ endSeconds: Math.max(activeWord.seconds + 0.5, state.startSeconds + 5) });
  };

  return (
    <main className={`clip-editor ${uiHidden ? "is-ui-hidden" : ""} ${leftOpen ? "" : "is-left-collapsed"} ${rightOpen ? "" : "is-right-collapsed"}`}>
      <header className="clip-editor__header">
        <div>
          <Link href={`/dashboard/projects/${projectId}`} aria-label="Вернуться к проекту"><ArrowLeft size={19} /></Link>
          <input ref={titleRef} value={state.title} onChange={(event) => commit({ title: event.target.value })} />
          <small>
            {draftStatus === "saving" ? "Сохраняем…" : draftStatus === "changed" ? "Есть изменения" : "Черновик сохранён"}
          </small>
        </div>
        <nav aria-label="История и сохранение">
          <IconButton aria-label="Отменить" tooltip="Отменить" isDisabled={!past.length} onPress={undo}><Undo2 size={18} /></IconButton>
          <IconButton aria-label="Повторить" tooltip="Повторить" isDisabled={!future.length} onPress={redo}><Redo2 size={18} /></IconButton>
          <ActionButton tone="quiet" aria-label="Применить изменения" onPress={() => setScopeOpen(true)}>
            Применить
            <ChevronDown size={15} />
          </ActionButton>
          <ActionButton aria-label="Обновить клип" isDisabled={busy} onPress={runRerender}>
            {busy ? <LoaderCircle className="is-spinning" size={17} /> : <Sparkles size={17} />}
            Обновить клип
          </ActionButton>
        </nav>
      </header>

      {notice ? (
        <div className="clip-editor__notice" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <IconButton aria-label="Скрыть сообщение" tooltip="Закрыть" onPress={() => setNotice("")}><X size={16} /></IconButton>
        </div>
      ) : null}

      <div className="clip-editor__mobile-tabs" role="tablist" aria-label="Панели редактора" onKeyDown={handleTablistKeyDown}>
        {(["text", "tools", "properties"] as const).map((panel) => (
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === panel}
            tabIndex={mobilePanel === panel ? 0 : -1}
            className={mobilePanel === panel ? "is-active" : ""}
            onClick={() => setMobilePanel(panel)}
            key={panel}
          >
            {panel === "text" ? "Текст" : panel === "tools" ? "Инструменты" : "Свойства"}
          </button>
        ))}
      </div>

      <div className={`clip-editor__workspace mobile-panel-${mobilePanel}`}>
        <aside className={`clip-transcript-panel ${leftOpen ? "" : "is-collapsed"}`}>
          <header>
            <strong className="clip-transcript-panel__title">Транскрипт</strong>
            <IconButton aria-label={leftOpen ? "Свернуть левую панель" : "Развернуть левую панель"} tooltip={leftOpen ? "Свернуть панель" : "Развернуть панель"} onPress={() => setLeftOpen((value) => !value)}>
              {leftOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </IconButton>
          </header>
          <label className="clip-transcript-search">
            <Search size={15} />
            <input value={wordQuery} onChange={(event) => setWordQuery(event.target.value)} placeholder="Найти в тексте" />
          </label>
          <div className="clip-word-stream">
            {filteredWords.map((item, index) => (
              <button
                type="button"
                className={`${item.seconds >= state.startSeconds && item.seconds <= state.endSeconds ? "is-in-range" : ""} ${selectedWord === item.id ? "is-selected" : ""}`}
                title={`${item.speaker} · ${item.time}`}
                aria-label={`${item.speaker}, ${item.time}: ${wordEdits[item.id] ?? item.word}`}
                onClick={() => { setSelectedWord(item.id); seekTo(item.seconds); }}
                key={item.id}
              >
                {index === 0 || filteredWords[index - 1]?.speaker !== item.speaker ? <span>{item.speaker} · {item.time}</span> : null}
                <i className={`${hiddenWords.includes(item.id) ? "is-hidden-caption" : ""} ${cutWords.includes(item.id) ? "is-cut" : ""}`}>
                  {wordEdits[item.id] ?? item.word}
                </i>
              </button>
            ))}
          </div>
          <div className="clip-word-actions">
            {activeWord ? (
              <label>
                <span>Исправить слово</span>
                <input
                  value={wordEdits[activeWord.id] ?? activeWord.word}
                  onChange={(event) => {
                    commitTranscript({ wordEdits: { ...wordEdits, [activeWord.id]: event.target.value } });
                    setDirty(true);
                    setDraftStatus("changed");
                  }}
                />
              </label>
            ) : <p>Выберите слово для точечной правки.</p>}
            <div>
              <ActionButton tone="secondary" isDisabled={!selectedWord} onPress={() => setBoundaryFromWord("start")}>Начало</ActionButton>
              <ActionButton tone="secondary" isDisabled={!selectedWord} onPress={() => setBoundaryFromWord("end")}>Конец</ActionButton>
            </div>
            <ActionButton
              tone="secondary"
              isDisabled={!selectedWord}
              aria-pressed={selectedWord ? hiddenWords.includes(selectedWord) : false}
              onPress={() => {
                if (!selectedWord) return;
                commitTranscript({ hiddenWords: hiddenWords.includes(selectedWord) ? hiddenWords.filter((id) => id !== selectedWord) : [...hiddenWords, selectedWord] });
                setDirty(true);
                setDraftStatus("changed");
              }}
            >
              {selectedWord && hiddenWords.includes(selectedWord) ? "Вернуть в субтитры" : "Скрыть из субтитров"}
            </ActionButton>
            <ActionButton
              tone="secondary"
              isDisabled={!selectedWord}
              aria-pressed={selectedWord ? cutWords.includes(selectedWord) : false}
              onPress={() => {
                if (!selectedWord) return;
                commitTranscript({ cutWords: cutWords.includes(selectedWord) ? cutWords.filter((id) => id !== selectedWord) : [...cutWords, selectedWord] });
                setDirty(true);
                setDraftStatus("changed");
              }}
            >
              {selectedWord && cutWords.includes(selectedWord) ? "Вернуть звук" : "Вырезать со звуком"}
            </ActionButton>
          </div>
        </aside>

        <aside className="clip-mobile-tools" aria-label="Инструменты клипа">
          <div>
            <EditorSectionTools
              active={inspectorSection}
              onChange={(section) => {
                setInspectorSection(section);
                setMobilePanel("properties");
              }}
            />
          </div>
          <p>Выберите часть клипа — её настройки откроются здесь же.</p>
        </aside>

        <section className="clip-preview-stage">
          {!leftOpen ? (
            <IconButton className="clip-panel-restore is-left" aria-label="Развернуть левую панель" tooltip="Развернуть текст" onPress={() => setLeftOpen(true)}>
              <PanelLeftOpen size={17} />
            </IconButton>
          ) : null}
          {!rightOpen ? (
            <IconButton className="clip-panel-restore is-right" aria-label="Развернуть панель свойств" tooltip="Развернуть свойства" onPress={() => setRightOpen(true)}>
              <PanelRightOpen size={17} />
            </IconButton>
          ) : null}
          <div
            className={`clip-phone-preview preset-${state.subtitlePreset} layout-${state.layout} ${hasCompositionPreview ? "has-composition-preview" : ""}`}
            style={{ "--editor-zoom": zoom / 100 } as React.CSSProperties}
          >
            {playbackUrl || sourceReviewUrl ? (
              <>
                <video
                  className="clip-phone-preview__video"
                  ref={videoRef}
                  src={playbackUrl ?? sourceReviewUrl ?? undefined}
                  crossOrigin={sourceReviewUrl && !playbackUrl ? "anonymous" : undefined}
                  onError={retrySourceReviewAfterMediaError}
                  playsInline
                  preload="metadata"
                />
                {sourceReviewUrl && !playbackUrl && sourceReviewSequence?.previewMode === "dual_media_crossfade" ? (
                  <video
                    aria-hidden="true"
                    className="clip-phone-preview__video clip-phone-preview__video--secondary"
                    ref={secondaryVideoRef}
                    src={sourceReviewUrl}
                    crossOrigin="anonymous"
                    onError={retrySourceReviewAfterMediaError}
                    playsInline
                    preload="auto"
                  />
                ) : null}
              </>
            ) : (
              <div className="clip-phone-preview__speaker">
                {canUseApi && sourceReviewPending
                  ? sourceReviewReason === "browser_media_contract_unavailable"
                    ? "Безопасный preview исходника временно недоступен"
                    : "Подготавливаем совместимый proxy"
                  : sourceReviewReason === "source_review_failed"
                    ? "Не удалось открыть preview исходника"
                  : "Финальный предпросмотр появится после рендера"}
                <small>Оформление не имитируется до построения HVE-плана</small>
              </div>
            )}
            {hasCompositionPreview && sourceReviewComposition ? (
              <HveCompositionPreview
                plan={sourceReviewComposition.resolvedPlan}
                captionStyle={sourceReviewComposition.captionStyle}
                outputTimeSeconds={currentTime}
                videoRef={videoRef}
                secondaryVideoRef={secondaryVideoRef}
                safeZonesVisible={safeZonesVisible}
              />
            ) : null}
            {sourceReviewUrl && !playbackUrl ? (
              <p className="clip-phone-preview__source-review" role="status">
                {hasCompositionPreview
                  ? "Композиционный preview HVE"
                  : hasSourceSequence
                    ? sourceReviewSequence?.previewMode === "dual_media_crossfade"
                      ? sourceReviewReason === "crossfade_audio_unavailable"
                        ? "Плавный переход · звук проверяется в финальном рендере"
                        : "Исходник по HVE-последовательности · плавные переходы"
                      : "Исходник по HVE-последовательности"
                    : "Исходник для проверки"}
                {" · "}{sourceReviewKind === "proxy" ? "proxy" : "оригинал"}
              </p>
            ) : null}
            {playbackUrl ? <p className="clip-phone-preview__rendered">Финальный рендер</p> : null}
            {safeZonesVisible && !sourceReviewUrl && !playbackUrl ? <div className="clip-phone-preview__safe-zone" /> : null}
            {(playbackUrl || sourceReviewUrl) ? <IconButton className="clip-phone-preview__play" tone="light" aria-label={playing ? "Пауза" : "Воспроизвести"} tooltip={playing ? "Пауза" : "Воспроизвести"} onPress={() => setPlaying((value) => !value)}>
              {playing ? <Pause fill="currentColor" size={20} /> : <Play fill="currentColor" size={20} />}
            </IconButton> : null}
          </div>
          <div className="clip-trim">
            <div className="clip-transport">
              <IconButton aria-label={playing ? "Пауза" : "Воспроизвести"} tooltip={playing ? "Пауза" : "Воспроизвести"} onPress={() => setPlaying((value) => !value)}>
                {playing ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}
              </IconButton>
              <span>{formatClock(currentTime)}</span>
              <strong>{Math.round(timelineEnd - timelineStart)} сек.</strong>
              <span>{formatClock(timelineEnd)}</span>
              <Volume2 size={15} />
              <label><ZoomIn size={14} /><input aria-label="Масштаб холста" type="range" min={50} max={100} step={25} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>{zoom}%</span></label>
            </div>
            <RangeTimeline
              min={timelineMin}
              max={timelineMax}
              start={timelineStart}
              end={timelineEnd}
              playhead={playbackUrl || sourceReviewUrl ? currentTime : undefined}
              minDuration={5}
              formatTime={formatClock}
              disabled={hasSourceSequence}
              onScrub={hasSourceSequence ? undefined : playbackUrl || sourceReviewUrl ? seekTo : undefined}
              onChange={({ start, end }) => commit({
                startSeconds: Math.round(start),
                endSeconds: Math.round(end),
              })}
            />
          </div>
        </section>

        <aside className={`clip-inspector ${rightOpen ? "" : "is-collapsed"}`}>
          <header>
            <strong>{editorSections.find(({ id }) => id === inspectorSection)?.label}</strong>
            <IconButton aria-label="Свернуть свойства" tooltip="Свернуть панель" onPress={() => setRightOpen(false)}><PanelRightClose size={17} /></IconButton>
          </header>

          <div className="clip-inspector__content">
            <nav className="clip-inspector__rail" aria-label="Инструменты клипа">
              <EditorSectionTools active={inspectorSection} onChange={setInspectorSection} compact />
            </nav>

            <div className="clip-inspector__body">
              {inspectorSection === "clip" ? (
                <section className="clip-inspector__section" aria-label="Общие настройки клипа">
              <label className="clip-field"><span>Название</span><input value={state.title} onChange={(event) => commit({ title: event.target.value })} /></label>
              <div className="clip-switch-row"><span>Удалять длинные паузы</span><Switch checked={state.silenceRemoval} aria-label="Удалять паузы" onCheckedChange={(value) => commit({ silenceRemoval: value })} /></div>
              <div className="clip-inspector__group">
                <span className="clip-inspector__group-label">Экспорт</span>
                <div className="option-card-grid clip-option-grid--two">
                  <OptionCard title="720p" selected={state.exportHeight === 1280} onSelect={() => commit({ exportHeight: 1280 })} />
                  <OptionCard title="1080p" selected={state.exportHeight === 1920} onSelect={() => commit({ exportHeight: 1920 })} />
                </div>
                <p className="clip-help-text">MP4, SRT и VTT создаются вместе.</p>
              </div>
              <div className="clip-inspector__group">
                <span className="clip-inspector__group-label">Для публикации</span>
                <label className="clip-field"><span>Заголовок</span><input value={state.socialTitle} onChange={(event) => commit({ socialTitle: event.target.value })} /></label>
                <label className="clip-field"><span>Описание</span><textarea rows={4} value={state.socialDescription} onChange={(event) => commit({ socialDescription: event.target.value })} /></label>
              </div>
                </section>
              ) : null}

              {inspectorSection === "frame" ? (
                <section className="clip-inspector__section" aria-label="Настройки кадра">
              <div className="option-card-grid">
                {layoutOptions.filter(({ rendersToday }) => rendersToday).map(({ id, label, hint, icon: Icon }) => (
                  <OptionCard
                    key={id}
                    icon={<Icon size={17} />}
                    title={label}
                    selected={state.layout === id}
                    tooltip={hint}
                    onSelect={() => commit({ layout: id })}
                  />
                ))}
              </div>
              <ActionButton
                className="clip-upload-asset"
                tone="secondary"
                aria-pressed={safeZonesVisible}
                onPress={() => setSafeZonesVisible((value) => !value)}
              >
                <Eye size={16} /> {safeZonesVisible ? "Скрыть safe zones" : "Показать safe zones"}
              </ActionButton>
              <p className="clip-help-text">Доступные режимы показаны без трекинга лиц. Более сложные композиции появятся только после подключения HVE-анализа.</p>
                </section>
              ) : null}

              {inspectorSection === "captions" ? (
                <section className="clip-inspector__section" aria-label="Настройки субтитров">
              <div className="clip-switch-row"><span>Показывать субтитры</span><Switch checked={state.captionsEnabled} aria-label="Показывать субтитры" onCheckedChange={(value) => commit({ captionsEnabled: value })} /></div>
              <SampleList
                aria-label="Стиль субтитров"
                value={state.subtitlePreset}
                onChange={(id) => commit({ subtitlePreset: id as SubtitlePreset })}
                items={subtitlePresets.map((preset) => ({
                  id: preset.id,
                  label: preset.label,
                  group: preset.group,
                  sample: (
                    <SubtitlePreviewOverlay
                      className="subtitle-overlay--sample"
                      text="Abc"
                      preset={preset.id}
                      animate={false}
                      color="var(--hp-text)"
                      activeColor={state.activeColor}
                    />
                  ),
                }))}
              />
              <div className="clip-field-pair">
                <label className="clip-field">
                  <span>Шрифт</span>
                  <Select
                    aria-label="Шрифт субтитров"
                    fullWidth
                    value={state.fontFamily}
                    onChange={(value) => commit({ fontFamily: value })}
                    options={fontOptions.map((name) => ({ id: name, label: name }))}
                  />
                </label>
                <label className="clip-field">
                  <span>Позиция</span>
                  <Select
                    aria-label="Позиция субтитров"
                    fullWidth
                    value={state.subtitlePosition}
                    onChange={(value) => commit({ subtitlePosition: value as ClipEditorState["subtitlePosition"] })}
                    options={positionOptions}
                  />
                </label>
              </div>
              <label className="clip-range-field"><span>Размер <b>{state.fontSize}px</b></span><input type="range" min={28} max={112} value={state.fontSize} onChange={(event) => commit({ fontSize: Number(event.target.value) })} /></label>
              <div className="clip-colors">
                <ColorField label="Основной" value={state.primaryColor} onChange={(value) => commit({ primaryColor: value })} />
                <ColorField label="Активный" value={state.activeColor} onChange={(value) => commit({ activeColor: value })} />
              </div>
                </section>
              ) : null}

              {inspectorSection === "title" ? (
                <section className="clip-inspector__section" aria-label="Настройки заголовка">
              <div className="clip-switch-row"><span>Показывать заголовок</span><Switch checked={state.titleEnabled} aria-label="Показывать заголовок" onCheckedChange={(value) => commit({ titleEnabled: value })} /></div>
              <label className="clip-field"><span>Текст</span><textarea rows={3} value={state.title} onChange={(event) => commit({ title: event.target.value })} /></label>
              <label className="clip-field">
                <span>Позиция</span>
                <Select
                  aria-label="Позиция заголовка"
                  fullWidth
                  value={state.titlePosition}
                  onChange={(value) => commit({ titlePosition: value as ClipEditorState["titlePosition"] })}
                  options={positionOptions}
                />
              </label>
                </section>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        isOpen={scopeOpen}
        onOpenChange={setScopeOpen}
        title="Куда применить?"
        description="Явная область изменений"
        footer={
          <>
            <ActionButton tone="secondary" onPress={() => setScopeOpen(false)}>Отменить</ActionButton>
            <ActionButton isDisabled={busy} onPress={saveVersion}>
              {busy ? <LoaderCircle className="is-spinning" size={17} /> : <Save size={17} />}Сохранить версию
            </ActionButton>
          </>
        }
      >
        <div className="clip-scope-options">
          {([
            ["clip", "Только этот клип", "Создать новую версию текущего клипа."],
            ["project", "Ко всему проекту", "Сделать эти настройки проектными, не меняя пресет."],
            ["style", "Обновить стиль", "Создать новую неизменяемую версию текущего стиля."],
            ["new_style", "Сохранить новым стилем", "Оставить исходный стиль без изменений."],
          ] as const).map(([id, title, text]) => (
            <SelectableRow
              key={id}
              title={title}
              description={text}
              selected={scope === id}
              onPress={() => setScope(id)}
            />
          ))}
        </div>
        {scope === "new_style" ? (
          <label className="clip-field"><span>Название стиля</span><input value={styleName} onChange={(event) => setStyleName(event.target.value)} /></label>
        ) : null}
      </Dialog>
    </main>
  );
}
