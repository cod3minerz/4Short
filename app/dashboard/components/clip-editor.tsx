"use client";

import { Button } from "@heroui/react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clapperboard,
  Crop,
  Droplet,
  Eye,
  Film,
  ImagePlus,
  LoaderCircle,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Quote,
  Redo2,
  Save,
  Search,
  Sparkles,
  Stamp,
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
import { ControlApiError, getClip, getClipPlayback, getTranscript, isControlApiConfigured, rerenderClip, updateClip } from "../lib/control-api";
import { layoutFromApi, layoutOptions, layoutToApi } from "../lib/layout-options";
import { toEditorWords, type EditorWord } from "../lib/transcript";
import { ColorField } from "./ui/ColorField";
import { Dialog } from "./ui/Dialog";
import { LockedField } from "./ui/LockedField";
import { OptionCard } from "./ui/OptionCard";
import { PanelSection } from "./ui/PanelSection";
import { RangeTimeline } from "./ui/RangeTimeline";
import { SampleList } from "./ui/SampleList";
import { Select } from "./ui/Select";
import { SubtitlePreviewOverlay } from "./ui/SubtitlePreviewOverlay";
import { Switch } from "./ui/Switch";
import { trackApp } from "../lib/track-app";
import type { ClipEditorState, SubtitlePreset } from "../types";

type ApplyScope = "clip" | "project" | "style" | "new_style";
type EditorPanel = "text" | "properties";

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

const fontOptions = ["Manrope", "Inter", "Onest", "Montserrat"];

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
  if (preset === "active_word" || preset === "word_pop") return "bold";
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
  const [uiHidden, setUiHidden] = useState(false);
  const [zoom, setZoom] = useState(75);
  const [safeZonesVisible, setSafeZonesVisible] = useState(true);
  const [editorWords, setEditorWords] = useState<EditorWord[]>(previewWords);
  const [transcriptRevision, setTranscriptRevision] = useState<number | null>(null);
  const [draftStatus, setDraftStatus] = useState<"saved" | "saving" | "changed">("saved");
  const titleRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const draftKey = `hashpix:clip-draft:${projectId}:${clipId}`;

  // Real rendered clip, when one exists. `null` means "not rendered yet" —
  // the preview says so instead of showing a fake video area.
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // Trim bounds come from the real media when we have it; otherwise from the
  // clip's own range, so the handles are never pinned to hardcoded seconds.
  const timelineMin = 0;
  const timelineMax = mediaDuration ?? Math.max(state.endSeconds + 30, state.startSeconds + 60);

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
        const edl = response.version?.edl as {
          layout?: { mode: string };
          subtitles?: {
            enabled: boolean; mode: string; preset: string;
            fontFamily: string; fontSize: number; position: "top" | "center" | "bottom";
            color: string; activeColor: string;
          };
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
          ...(edl?.export?.height === 1280 || edl?.export?.height === 1920
            ? { exportHeight: edl.export.height }
            : {}),
        }));
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

  // Drive the <video> from the editor's play/pause state and keep the
  // playhead in sync, looping playback within the trimmed range.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [playing, playbackUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      if (video.currentTime >= state.endSeconds) {
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
  }, [playing, state.endSeconds, state.startSeconds]);

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
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

  const persistDraft = useCallback(() => {
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
  }, [clipId, cutWords, draftKey, hiddenWords, savedVersion, state, wordEdits]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(persistDraft, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, persistDraft]);

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
      if (canUseApi && edl) {
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
      if (dirty) await saveVersion();
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
          <button type="button" disabled={!past.length} aria-label="Отменить" onClick={undo}><Undo2 size={18} /></button>
          <button type="button" disabled={!future.length} aria-label="Повторить" onClick={redo}><Redo2 size={18} /></button>
          <Button variant="tertiary" aria-label="Применить изменения" onPress={() => setScopeOpen(true)}>
            Применить
            <ChevronDown size={15} />
          </Button>
          <Button aria-label="Обновить клип" isDisabled={busy} onPress={runRerender}>
            {busy ? <LoaderCircle className="is-spinning" size={17} /> : <Sparkles size={17} />}
            Обновить клип
          </Button>
        </nav>
      </header>

      {notice ? (
        <div className="clip-editor__notice" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button type="button" aria-label="Скрыть сообщение" onClick={() => setNotice("")}><X size={16} /></button>
        </div>
      ) : null}

      <div className="clip-editor__mobile-tabs" role="tablist" aria-label="Панели редактора" onKeyDown={handleTablistKeyDown}>
        {(["text", "properties"] as const).map((panel) => (
          <button
            type="button"
            role="tab"
            aria-selected={mobilePanel === panel}
            tabIndex={mobilePanel === panel ? 0 : -1}
            className={mobilePanel === panel ? "is-active" : ""}
            onClick={() => setMobilePanel(panel)}
            key={panel}
          >
            {panel === "text" ? "Транскрипт" : "Свойства"}
          </button>
        ))}
      </div>

      <div className={`clip-editor__workspace mobile-panel-${mobilePanel}`}>
        <aside className={`clip-transcript-panel ${leftOpen ? "" : "is-collapsed"}`}>
          <header>
            <strong className="clip-transcript-panel__title">Транскрипт</strong>
            <button type="button" aria-label={leftOpen ? "Свернуть левую панель" : "Развернуть левую панель"} onClick={() => setLeftOpen((value) => !value)}>
              {leftOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>
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
              <button type="button" disabled={!selectedWord} onClick={() => setBoundaryFromWord("start")}>Начало</button>
              <button type="button" disabled={!selectedWord} onClick={() => setBoundaryFromWord("end")}>Конец</button>
            </div>
            <button
              type="button"
              disabled={!selectedWord}
              aria-pressed={selectedWord ? hiddenWords.includes(selectedWord) : false}
              onClick={() => {
                if (!selectedWord) return;
                commitTranscript({ hiddenWords: hiddenWords.includes(selectedWord) ? hiddenWords.filter((id) => id !== selectedWord) : [...hiddenWords, selectedWord] });
                setDirty(true);
                setDraftStatus("changed");
              }}
            >
              {selectedWord && hiddenWords.includes(selectedWord) ? "Вернуть в субтитры" : "Скрыть из субтитров"}
            </button>
            <button
              type="button"
              disabled={!selectedWord}
              aria-pressed={selectedWord ? cutWords.includes(selectedWord) : false}
              onClick={() => {
                if (!selectedWord) return;
                commitTranscript({ cutWords: cutWords.includes(selectedWord) ? cutWords.filter((id) => id !== selectedWord) : [...cutWords, selectedWord] });
                setDirty(true);
                setDraftStatus("changed");
              }}
            >
              {selectedWord && cutWords.includes(selectedWord) ? "Вернуть звук" : "Вырезать со звуком"}
            </button>
          </div>
        </aside>

        <section className="clip-preview-stage">
          {!leftOpen ? (
            <button className="clip-panel-restore is-left" type="button" aria-label="Развернуть левую панель" onClick={() => setLeftOpen(true)}>
              <PanelLeftOpen size={17} />
            </button>
          ) : null}
          {!rightOpen ? (
            <button className="clip-panel-restore is-right" type="button" aria-label="Развернуть панель свойств" onClick={() => setRightOpen(true)}>
              <PanelRightOpen size={17} />
            </button>
          ) : null}
          <div
            className={`clip-phone-preview preset-${state.subtitlePreset} layout-${state.layout}`}
            style={{ "--editor-zoom": zoom / 100 } as React.CSSProperties}
          >
            {safeZonesVisible ? <div className="clip-phone-preview__safe-zone" /> : null}
            {state.logoEnabled ? <span className="clip-phone-preview__logo">ВАШ ЛОГОТИП</span> : null}
            {state.titleEnabled ? <h2 className={`is-${state.titlePosition}`}>{state.title}</h2> : null}
            {playbackUrl ? (
              <video
                className="clip-phone-preview__video"
                ref={videoRef}
                src={playbackUrl}
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="clip-phone-preview__speaker">
                {canUseApi ? "Клип ещё рендерится" : "Предпросмотр появится после рендера"}
                <small>{layoutOptions.find((item) => item.id === state.layout)?.label}</small>
              </div>
            )}
            {state.captionsEnabled ? (
              <div className={`clip-phone-preview__subtitles is-${state.subtitlePosition}`} aria-hidden="true">
                <SubtitlePreviewOverlay
                  text="ПЕРВЫЙ ПРОДУКТ НЕ ОБЯЗАН БЫТЬ ИДЕАЛЬНЫМ"
                  preset={state.subtitlePreset}
                  fontFamily={state.fontFamily}
                  fontSize={state.fontSize}
                  position={state.subtitlePosition}
                  color={state.primaryColor}
                  activeColor={state.activeColor}
                  // Follows real playback once a rendered clip is loaded.
                  animate={!playbackUrl || playing}
                />
              </div>
            ) : null}
            {state.bannerEnabled ? <div className="clip-phone-preview__banner">ВАШ БАННЕР</div> : null}
            <button className="clip-phone-preview__play" type="button" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => setPlaying((value) => !value)}>
              {playing ? <Pause fill="currentColor" size={20} /> : <Play fill="currentColor" size={20} />}
            </button>
          </div>
          <div className="clip-trim">
            <div className="clip-transport">
              <button type="button" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => setPlaying((value) => !value)}>
                {playing ? <Pause fill="currentColor" size={15} /> : <Play fill="currentColor" size={15} />}
              </button>
              <span>{formatClock(state.startSeconds)}</span>
              <strong>{Math.round(state.endSeconds - state.startSeconds)} сек.</strong>
              <span>{formatClock(state.endSeconds)}</span>
              <Volume2 size={15} />
              <label><ZoomIn size={14} /><input aria-label="Масштаб холста" type="range" min={50} max={100} step={25} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>{zoom}%</span></label>
            </div>
            <RangeTimeline
              min={timelineMin}
              max={timelineMax}
              start={state.startSeconds}
              end={state.endSeconds}
              playhead={playbackUrl ? currentTime : undefined}
              minDuration={5}
              formatTime={formatClock}
              onScrub={playbackUrl ? seekTo : undefined}
              onChange={({ start, end }) => commit({
                startSeconds: Math.round(start),
                endSeconds: Math.round(end),
              })}
            />
          </div>
        </section>

        <aside className={`clip-inspector ${rightOpen ? "" : "is-collapsed"}`}>
          <header>
            <strong>Настройки клипа</strong>
            <button type="button" aria-label="Свернуть свойства" onClick={() => setRightOpen(false)}><PanelRightClose size={17} /></button>
          </header>

          <div className="clip-inspector__body">
            <PanelSection icon={<WandSparkles size={17} />} title="Клип">
              <label className="clip-field"><span>Название</span><input value={state.title} onChange={(event) => commit({ title: event.target.value })} /></label>
              <div className="clip-switch-row"><span>Удалять длинные паузы</span><Switch checked={state.silenceRemoval} aria-label="Удалять паузы" onCheckedChange={(value) => commit({ silenceRemoval: value })} /></div>
              <LockedField label="Нормализовать звук" reason="Нет в конвейере рендера — пока недоступно" />
            </PanelSection>

            <PanelSection icon={<Crop size={17} />} title="Формат кадра">
              <div className="option-card-grid">
                {layoutOptions.map(({ id, label, hint, icon: Icon, rendersToday }) => (
                  rendersToday ? (
                    <OptionCard
                      key={id}
                      icon={<Icon size={17} />}
                      title={label}
                      selected={state.layout === id}
                      tooltip={hint}
                      onSelect={() => commit({ layout: id })}
                    />
                  ) : (
                    <LockedField key={id} icon={<Icon size={16} />} label={label} reason="Нужен трекинг лица — скоро" />
                  )
                ))}
              </div>
              <LockedField
                label="Спикер в кадре"
                reason="Нужен трекинг лица — скоро"
              />
              <button
                className="clip-upload-asset"
                type="button"
                aria-pressed={safeZonesVisible}
                onClick={() => setSafeZonesVisible((value) => !value)}
              >
                <Eye size={16} /> {safeZonesVisible ? "Скрыть safe zones" : "Показать safe zones"}
              </button>
            </PanelSection>

            <PanelSection
              icon={<Subtitles size={17} />}
              title="Субтитры"
              headerControl={<Switch checked={state.captionsEnabled} aria-label="Показывать субтитры" onCheckedChange={(value) => commit({ captionsEnabled: value })} />}
            >
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
                      color="#ffffff"
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
            </PanelSection>

            <PanelSection
              icon={<Type size={17} />}
              title="Заголовок"
              defaultExpanded={false}
              headerControl={<Switch checked={state.titleEnabled} aria-label="Показывать заголовок" onCheckedChange={(value) => commit({ titleEnabled: value })} />}
            >
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
            </PanelSection>

            <PanelSection
              icon={<ImagePlus size={17} />}
              title="Баннер"
              defaultExpanded={false}
              headerControl={<Switch checked={state.bannerEnabled} aria-label="Показывать баннер" onCheckedChange={(value) => commit({ bannerEnabled: value })} />}
            >
              <p className="clip-help-text">Изображение и его положение задаются в стиле — так они одинаковы во всех клипах проекта.</p>
            </PanelSection>

            <PanelSection
              icon={<Stamp size={17} />}
              title="Логотип"
              defaultExpanded={false}
              headerControl={<Switch checked={state.logoEnabled} aria-label="Показывать логотип" onCheckedChange={(value) => commit({ logoEnabled: value })} />}
            >
              <p className="clip-help-text">Изображение и его положение задаются в стиле — так они одинаковы во всех клипах проекта.</p>
            </PanelSection>

            <PanelSection icon={<Sparkles size={17} />} title="Качество рендера" defaultExpanded={false}>
              <div className="option-card-grid clip-option-grid--two">
                <OptionCard title="720p" selected={state.exportHeight === 1280} onSelect={() => commit({ exportHeight: 1280 })} />
                <OptionCard title="1080p" selected={state.exportHeight === 1920} onSelect={() => commit({ exportHeight: 1920 })} />
              </div>
              <LockedField label="2K / 4K" reason="Скоро" />
              <p className="clip-help-text">MP4, SRT и VTT создаются вместе.</p>
            </PanelSection>

            <PanelSection icon={<Quote size={17} />} title="Для соцсетей" defaultExpanded={false}>
              <label className="clip-field"><span>Заголовок публикации</span><input value={state.socialTitle} onChange={(event) => commit({ socialTitle: event.target.value })} /></label>
              <label className="clip-field"><span>Описание</span><textarea rows={4} value={state.socialDescription} onChange={(event) => commit({ socialDescription: event.target.value })} /></label>
            </PanelSection>

            <div className="clip-locked-stack">
              <LockedField icon={<Quote size={16} />} label="Хук" reason="Скоро" />
              <LockedField icon={<Clapperboard size={16} />} label="AI B-roll" reason="Скоро" />
              <LockedField icon={<Music2 size={16} />} label="AI музыка" reason="Скоро" />
              <LockedField icon={<Droplet size={16} />} label="Свой водяной знак" reason="Скоро" />
              <LockedField icon={<Film size={16} />} label="Своё аутро" reason="Скоро" />
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
            <Button variant="outline" onPress={() => setScopeOpen(false)}>Отменить</Button>
            <Button isDisabled={busy} onPress={saveVersion}>
              {busy ? <LoaderCircle className="is-spinning" size={17} /> : <Save size={17} />}Сохранить версию
            </Button>
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
            <button type="button" className={scope === id ? "is-selected" : ""} onClick={() => setScope(id)} key={id}>
              <span>{scope === id ? <Check size={15} /> : null}</span>
              <div><strong>{title}</strong><small>{text}</small></div>
            </button>
          ))}
        </div>
        {scope === "new_style" ? (
          <label className="clip-field"><span>Название стиля</span><input value={styleName} onChange={(event) => setStyleName(event.target.value)} /></label>
        ) : null}
      </Dialog>
    </main>
  );
}
