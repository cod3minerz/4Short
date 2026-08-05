import type { ClipDocumentV2, EditorCommand } from "@/packages/contracts/src/index";
import type { ClipEditorState } from "../types";
import type { EditorWord } from "./transcript";

export type HveDraftMetadata = {
  title: string;
  socialTitle: string | null;
  socialDescription: string | null;
};

export type HveDraftSnapshot = {
  clipId: string;
  revision: number;
  document: ClipDocumentV2;
  metadata: HveDraftMetadata;
};

export type HveDraftSyncInput = {
  draft: HveDraftSnapshot;
  state: ClipEditorState;
  words: EditorWord[];
  wordEdits: Record<string, string>;
  hiddenWords: string[];
  cutWords: string[];
  clientId: string;
  firstSequence: number;
  batchId: string;
  createdAt: string;
  createCommandId: () => string;
};

export type HveDraftSyncResult = {
  commands: EditorCommand[];
  nextSequence: number;
  unsupported: string[];
};

const hveTemplateByEditorLayout: Partial<Record<ClipEditorState["layout"], "portrait_focus" | "blur_background">> = {
  auto: "portrait_focus",
  solo: "portrait_focus",
  static_crop: "portrait_focus",
  blur: "blur_background",
};

function titlePlacement(position: ClipEditorState["titlePosition"]) {
  if (position === "top") return { anchor: "top_center" as const, box: { x: 0.08, y: 0.06, width: 0.84, height: 0.17 } };
  if (position === "center") return { anchor: "center" as const, box: { x: 0.08, y: 0.405, width: 0.84, height: 0.19 } };
  return { anchor: "bottom_center" as const, box: { x: 0.08, y: 0.74, width: 0.84, height: 0.16 } };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

/**
 * Translates the controls that the legacy focus shell already exposes into
 * typed HVE commands. It purposefully reports unsupported controls instead
 * of approximating a layout or asset layer. Text titles, captions and audio
 * policy have their own executable command contracts; banner/logo assets do
 * not unlock until their verified upload and layer commands are connected.
 */
export function buildHveDraftSync(input: HveDraftSyncInput): HveDraftSyncResult {
  const { draft, state } = input;
  const unsupported: string[] = [];
  const commands: EditorCommand[] = [];
  let sequence = input.firstSequence;
  const base = {
    batchId: input.batchId,
    clipId: draft.clipId,
    clientId: input.clientId,
    baseRevision: draft.revision,
    createdAt: input.createdAt,
  };
  const command = <T extends Omit<EditorCommand, keyof typeof base | "commandId" | "clientSequence">>(payload: T) => {
    sequence += 1;
    commands.push({
      ...base,
      ...payload,
      commandId: input.createCommandId(),
      clientSequence: sequence,
    // The API boundary validates this discriminated union again. TypeScript
    // cannot preserve the discriminant through a generic object spread.
    } as unknown as EditorCommand);
  };

  const desiredMetadata = {
    title: state.title.trim(),
    socialTitle: nullableText(state.socialTitle),
    socialDescription: nullableText(state.socialDescription),
  };
  const metadataPatch = Object.fromEntries(
    Object.entries(desiredMetadata).filter(([key, value]) => draft.metadata[key as keyof HveDraftMetadata] !== value),
  );
  if (Object.keys(metadataPatch).length) command({ kind: "set_clip_metadata", patch: metadataPatch });

  const requestedTemplate = hveTemplateByEditorLayout[state.layout];
  if (!requestedTemplate) {
    unsupported.push("Выбранный вариант кадра ещё не имеет подтверждённого HVE-плана.");
  } else {
    const layout = draft.document.layout[0];
    if (!layout) {
      unsupported.push("В документе клипа нет доступного layout-сегмента.");
    } else if (layout.template !== requestedTemplate) {
      command({
        kind: "set_layout",
        anchor: layout.anchor,
        template: requestedTemplate,
        slots: layout.slots.map((slot) => ({
          ...slot,
          fit: requestedTemplate === "blur_background" ? "contain" : "cover",
        })),
      });
    }
  }

  const narrative = draft.document.narrative.length === 1 ? draft.document.narrative[0] : undefined;
  if (!narrative) {
    unsupported.push("Редактирование нескольких фрагментов в одном клипе будет подключено после segment-strip.");
  } else {
    const desiredRange = {
      startUs: Math.round(state.startSeconds * 1_000_000),
      endUs: Math.round(state.endSeconds * 1_000_000),
    };
    if (!sameJson(narrative.sourceRange, desiredRange)) {
      if (desiredRange.startUs < narrative.sourceRange.startUs || desiredRange.endUs > narrative.sourceRange.endUs || desiredRange.endUs <= desiredRange.startUs) {
        unsupported.push("Границы можно сужать только внутри исходного фрагмента.");
      } else {
        command({ kind: "trim_narrative", segmentId: narrative.id, sourceRange: desiredRange });
      }
    }
  }

  if (draft.document.captions.enabled !== state.captionsEnabled) {
    command({ kind: "set_caption_track", patch: { enabled: state.captionsEnabled } });
  }
  const desiredStyle = {
    preset: state.subtitlePreset,
    fontFamily: state.fontFamily,
    fontSizePx: state.fontSize,
    fontWeight: 800,
    uppercase: false,
    maxWordsPerLine: 5,
    maxLines: 2,
    position: state.subtitlePosition,
    safeMarginPx: 160,
    color: state.primaryColor,
    activeColor: state.activeColor,
    outlineColor: "#0a0a0b",
    outlinePx: 4,
    background: state.subtitlePreset === "minimal_box",
  };
  const captionStylePatch = Object.fromEntries(
    Object.entries(desiredStyle).filter(([key, value]) => draft.document.captions.style[key as keyof typeof desiredStyle] !== value),
  );
  if (Object.keys(captionStylePatch).length) command({ kind: "set_caption_style", patch: captionStylePatch });

  const desiredPauseRemoval = { ...draft.document.audio.pauseRemoval, enabled: state.silenceRemoval, crossfadeUs: 0 };
  if (!sameJson(draft.document.audio.pauseRemoval, desiredPauseRemoval)) {
    command({ kind: "set_audio_policy", patch: { pauseRemoval: desiredPauseRemoval } });
  }
  const desiredExport = {
    width: state.exportHeight === 1920 ? 1080 : 720,
    height: state.exportHeight,
    fps: 30,
    videoCodec: "h264" as const,
    audioCodec: "aac" as const,
    videoBitrateKbps: state.exportHeight === 1920 ? 6500 : 3600,
    audioBitrateKbps: 160,
    watermark: false,
  };
  if (!sameJson(draft.document.export, desiredExport)) command({ kind: "set_export_profile", profile: desiredExport });

  const trackedWordIds = new Set(draft.document.captions.words.map((word) => word.wordId));
  const canonicalWordIds = new Set(input.words.map((word) => word.id));
  for (const wordId of Object.keys(input.wordEdits)) {
    if (!trackedWordIds.has(wordId) || !canonicalWordIds.has(wordId)) unsupported.push("Часть изменённого текста относится к устаревшей версии транскрипта.");
  }
  for (const captionWord of draft.document.captions.words) {
    if (!canonicalWordIds.has(captionWord.wordId)) continue;
    const nextText = input.wordEdits[captionWord.wordId];
    if (nextText !== undefined && nextText.trim() && nextText.trim() !== captionWord.displayText) {
      command({ kind: "replace_word", wordId: captionWord.wordId, displayText: nextText.trim() });
    }
    if (nextText === undefined && captionWord.displayText) command({ kind: "clear_word_display", wordId: captionWord.wordId });
  }

  const desiredHidden = new Set(input.hiddenWords.filter((wordId) => trackedWordIds.has(wordId)));
  const desiredCut = new Set(input.cutWords.filter((wordId) => trackedWordIds.has(wordId)));
  for (const target of [true, false] as const) {
    const wordIds = draft.document.captions.words
      .filter((word) => word.hidden !== desiredHidden.has(word.wordId) && desiredHidden.has(word.wordId) === target)
      .map((word) => word.wordId);
    if (wordIds.length) command({ kind: "set_word_visibility", wordIds, hidden: target });
  }
  for (const target of [true, false] as const) {
    const wordIds = draft.document.captions.words
      .filter((word) => Boolean(word.cutFromMedia) !== desiredCut.has(word.wordId) && desiredCut.has(word.wordId) === target)
      .map((word) => word.wordId);
    if (wordIds.length) command({ kind: "cut_words", wordIds, cut: target });
  }

  const titleLayer = draft.document.layers.find((layer) => layer.type === "text");
  if (state.titleEnabled && !titleLayer) {
    const placement = titlePlacement(state.titlePosition);
    command({
      kind: "add_layer",
      layer: {
        id: input.createCommandId(),
        type: "text",
        text: state.title.trim() || "Заголовок",
        styleRef: "hve-title-v1",
        anchorRange: { start: { kind: "clip_start" }, end: { kind: "clip_end", offsetUs: 0 } },
        followPolicy: "absolute_output",
        zIndex: 10,
        ...placement,
        opacity: 1,
        collisionPolicy: "warn",
      },
    });
  } else if (!state.titleEnabled && titleLayer) {
    command({ kind: "remove_layer", layerId: titleLayer.id });
  } else if (state.titleEnabled && titleLayer) {
    const placement = titlePlacement(state.titlePosition);
    const patch: { text?: string; anchor?: typeof placement.anchor; box?: typeof placement.box } = {};
    if (titleLayer.text !== state.title.trim()) patch.text = state.title.trim() || "Заголовок";
    if (titleLayer.anchor !== placement.anchor) patch.anchor = placement.anchor;
    if (!sameJson(titleLayer.box, placement.box)) patch.box = placement.box;
    if (Object.keys(patch).length) command({ kind: "set_text_layer", layerId: titleLayer.id, patch });
  }
  if (state.bannerEnabled || state.logoEnabled) {
    unsupported.push("Баннер и логотип требуют отдельного versioned asset-layer пути.");
  }
  return { commands, nextSequence: sequence, unsupported: [...new Set(unsupported)] };
}
