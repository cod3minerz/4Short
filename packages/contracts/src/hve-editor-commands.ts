import {
  audioPolicySchema,
  captionTrackSchema,
  clipDraftMetadataSchema,
  clipDocumentV2Schema,
  editorCommandSchema,
  normalizedRectSchema,
  type ClipDocumentV2,
  type ClipDraftMetadata,
  type EditorCommand,
} from "./hve-v2.js";
import { buildUserVerifiedFaceGridSlots, buildUserVerifiedScreenCompositeSlots } from "./hve-layout.js";
import { z } from "zod";

/**
 * Transport contract for an atomic draft mutation. `batchId` is the
 * idempotency identity; it is deliberately separate from a render command.
 */
export const applyEditorCommandBatchSchema = z.object({
  batchId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  commands: z.array(editorCommandSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  for (const [index, command] of value.commands.entries()) {
    if (command.batchId !== value.batchId) {
      context.addIssue({
        code: "custom",
        path: ["commands", index, "batchId"],
        message: "Every command must belong to the request batch.",
      });
    }
    if (command.baseRevision !== value.baseRevision) {
      context.addIssue({
        code: "custom",
        path: ["commands", index, "baseRevision"],
        message: "Every command must use the request base revision.",
      });
    }
  }
});

/** Explicit transition from a mutable draft to an immutable clip version. */
export const commitEditorDraftSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict();

/** Raised before a draft is persisted; a rejected command never becomes a render input. */
export class HveEditorCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HveEditorCommandError";
  }
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function assertUniqueCommandIds(commands: EditorCommand[]) {
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.commandId)) throw new HveEditorCommandError("HVE_EDITOR_COMMAND_DUPLICATE", "A command batch cannot contain the same command twice.");
    ids.add(command.commandId);
  }
}

function assertCommandClipIds(commands: EditorCommand[], clipId: string) {
  for (const command of commands) {
    if (command.clipId !== clipId) throw new HveEditorCommandError("HVE_EDITOR_CLIP_MISMATCH", "A command does not belong to this clip.");
  }
}

function updateCaptionWords(
  document: ClipDocumentV2,
  ids: string[],
  patch: Partial<ClipDocumentV2["captions"]["words"][number]>,
) {
  const words = [...document.captions.words];
  for (const wordId of ids) {
    const index = words.findIndex((word) => word.wordId === wordId);
    if (index === -1) {
      // A draft must never promise an edit to media/timing that it cannot
      // address. The planner can only honour canonical transcript words.
      throw new HveEditorCommandError("HVE_EDITOR_WORD_NOT_FOUND", "The selected transcript word is no longer available in this clip.");
    } else {
      words[index] = { ...words[index]!, ...patch };
    }
  }
  return captionTrackSchema.parse({ ...document.captions, words });
}

function requireNarrative(document: ClipDocumentV2, segmentId: string) {
  const segment = document.narrative.find((candidate) => candidate.id === segmentId);
  if (!segment) throw new HveEditorCommandError("HVE_EDITOR_NARRATIVE_NOT_FOUND", "The selected narrative segment no longer exists.");
  return segment;
}

function requireLayout(document: ClipDocumentV2, layoutSegmentId: string) {
  const layout = document.layout.find((candidate) => candidate.id === layoutSegmentId);
  if (!layout) throw new HveEditorCommandError("HVE_EDITOR_LAYOUT_NOT_FOUND", "The selected layout segment no longer exists.");
  return layout;
}

/**
 * Applies a bounded editor batch as pure data. No media, planner or renderer
 * side effect is allowed here: callers save the normalized draft first, then
 * explicitly create an immutable version in a separate command.
 */
export function applyEditorCommands(documentInput: ClipDocumentV2, commandsInput: EditorCommand[]): ClipDocumentV2 {
  let document = clipDocumentV2Schema.parse(documentInput);
  const commands = commandsInput.map((command) => editorCommandSchema.parse(command));
  assertUniqueCommandIds(commands);
  assertCommandClipIds(commands, document.clipId);
  for (const command of commands) {
    switch (command.kind) {
      case "replace_word":
        document = clipDocumentV2Schema.parse({
          ...document,
          captions: updateCaptionWords(document, [command.wordId], { displayText: command.displayText }),
        });
        break;
      case "clear_word_display": {
        const words = document.captions.words.map((word) => {
          if (word.wordId !== command.wordId) return word;
          const { displayText, ...withoutDisplayText } = word;
          void displayText;
          return withoutDisplayText;
        });
        if (!document.captions.words.some((word) => word.wordId === command.wordId)) {
          throw new HveEditorCommandError("HVE_EDITOR_WORD_NOT_FOUND", "The selected transcript word is no longer available in this clip.");
        }
        document = clipDocumentV2Schema.parse({ ...document, captions: { ...document.captions, words } });
        break;
      }
      case "set_word_visibility":
        document = clipDocumentV2Schema.parse({
          ...document,
          captions: updateCaptionWords(document, command.wordIds, { hidden: command.hidden }),
        });
        break;
      case "cut_words":
        document = clipDocumentV2Schema.parse({
          ...document,
          captions: updateCaptionWords(document, command.wordIds, { cutFromMedia: command.cut }),
        });
        break;
      case "trim_narrative": {
        const selected = requireNarrative(document, command.segmentId);
        if (command.sourceRange.startUs < selected.sourceRange.startUs || command.sourceRange.endUs > selected.sourceRange.endUs) {
          throw new HveEditorCommandError("HVE_EDITOR_TRIM_OUTSIDE_SEGMENT", "A trim cannot extend outside the original narrative segment.");
        }
        document = clipDocumentV2Schema.parse({
          ...document,
          narrative: document.narrative.map((segment) => segment.id === command.segmentId ? { ...segment, sourceRange: command.sourceRange } : segment),
        });
        break;
      }
      case "reorder_narrative": {
        if (command.orderedSegmentIds.length !== document.narrative.length || new Set(command.orderedSegmentIds).size !== document.narrative.length) {
          throw new HveEditorCommandError("HVE_EDITOR_REORDER_INCOMPLETE", "A reorder must contain every narrative segment exactly once.");
        }
        const existing = new Set(document.narrative.map((segment) => segment.id));
        if (command.orderedSegmentIds.some((id) => !existing.has(id))) {
          throw new HveEditorCommandError("HVE_EDITOR_REORDER_UNKNOWN_SEGMENT", "A reorder contains a missing narrative segment.");
        }
        const orderById = new Map(command.orderedSegmentIds.map((id, index) => [id, index]));
        document = clipDocumentV2Schema.parse({
          ...document,
          narrative: document.narrative.map((segment) => ({ ...segment, order: orderById.get(segment.id)! })),
        });
        break;
      }
      case "set_layout": {
        const selected = document.layout.find((layout) => sameJson(layout.anchor, command.anchor));
        if (!selected) {
          throw new HveEditorCommandError("HVE_EDITOR_LAYOUT_ANCHOR_NOT_FOUND", "Choose an existing layout range before changing its template.");
        }
        document = clipDocumentV2Schema.parse({
          ...document,
          layout: document.layout.map((layout) => layout.id === selected.id ? {
            ...layout,
            template: command.template,
            ...(command.slots ? { slots: command.slots } : {}),
            provenance: { origin: "user", reasonCode: "EDITOR_SET_LAYOUT" },
            lockedByUser: true,
          } : layout),
        });
        break;
      }
      case "set_user_verified_face_grid": {
        requireLayout(document, command.layoutSegmentId);
        // The command carries identities only. Slot geometry, source binding
        // and analysis binding are derived here from the canonical document;
        // commit preflight still refuses this layout without dense perception
        // coverage for all retained source intervals.
        const slots = buildUserVerifiedFaceGridSlots(document, {
          template: command.template,
          faceTrackIds: command.faceTrackIds,
        });
        document = clipDocumentV2Schema.parse({
          ...document,
          layout: document.layout.map((layout) => layout.id === command.layoutSegmentId ? {
            ...layout,
            template: command.template,
            slots,
            provenance: { origin: "user", reasonCode: "EDITOR_USER_VERIFIED_FACE_GRID" },
            lockedByUser: true,
          } : layout),
        });
        break;
      }
      case "set_user_verified_screen_composite": {
        requireLayout(document, command.layoutSegmentId);
        // Screen/gameplay pixels remain a user-selected source crop. Like the
        // grid command, this intentionally derives slots from the immutable
        // document instead of allowing an arbitrary client scene graph.
        const slots = buildUserVerifiedScreenCompositeSlots(document, {
          template: command.template,
          screenCrop: command.screenCrop,
          faceTrackId: command.faceTrackId,
        });
        document = clipDocumentV2Schema.parse({
          ...document,
          layout: document.layout.map((layout) => layout.id === command.layoutSegmentId ? {
            ...layout,
            template: command.template,
            slots,
            provenance: { origin: "user", reasonCode: "EDITOR_USER_VERIFIED_SCREEN_COMPOSITE" },
            lockedByUser: true,
          } : layout),
        });
        break;
      }
      case "set_layout_lock": {
        requireLayout(document, command.layoutSegmentId);
        document = clipDocumentV2Schema.parse({
          ...document,
          layout: document.layout.map((layout) => layout.id === command.layoutSegmentId ? { ...layout, lockedByUser: command.locked } : layout),
        });
        break;
      }
      case "set_manual_crop": {
        const selected = requireLayout(document, command.layoutSegmentId);
        if (!selected.slots.some((slot) => slot.slotId === command.slotId)) {
          throw new HveEditorCommandError("HVE_EDITOR_SLOT_NOT_FOUND", "The selected crop slot no longer exists.");
        }
        const crop = command.crop === null ? null : normalizedRectSchema.parse(command.crop);
        document = clipDocumentV2Schema.parse({
          ...document,
          layout: document.layout.map((layout) => layout.id === command.layoutSegmentId ? {
            ...layout,
            slots: layout.slots.map((slot) => slot.slotId === command.slotId
              ? (crop
                ? { ...slot, manualCrop: crop }
                : (() => {
                    const { manualCrop, ...withoutCrop } = slot;
                    void manualCrop;
                    return withoutCrop;
                  })())
              : slot),
          } : layout),
        });
        break;
      }
      case "set_crop_track": {
        const selected = requireLayout(document, command.layoutSegmentId);
        if (!selected.slots.some((slot) => slot.slotId === command.slotId)) {
          throw new HveEditorCommandError("HVE_EDITOR_SLOT_NOT_FOUND", "The selected crop slot no longer exists.");
        }
        // HVE-5 currently resolves one immutable scene graph per document.
        // Rebinding it is explicit and moves every existing crop-track ref to
        // the same verified analysis; a draft can never quietly mix facts
        // from two source-analysis runs.
        document = clipDocumentV2Schema.parse({
          ...document,
          analysisId: command.analysisId,
          sourceRefs: document.sourceRefs.map((source) => ({ ...source, analysisId: command.analysisId })),
          layout: document.layout.map((layout) => ({
            ...layout,
            slots: layout.slots.map((slot) => {
              const isSelected = layout.id === command.layoutSegmentId && slot.slotId === command.slotId;
              if (isSelected) return { ...slot, cropTrack: { analysisId: command.analysisId, trackId: command.trackId } };
              if (slot.cropTrack) return { ...slot, cropTrack: { ...slot.cropTrack, analysisId: command.analysisId } };
              return slot;
            }),
          })),
        });
        break;
      }
      case "add_layer":
        if (document.layers.some((layer) => layer.id === command.layer.id)) {
          throw new HveEditorCommandError("HVE_EDITOR_LAYER_DUPLICATE", "This production layer already exists.");
        }
        document = clipDocumentV2Schema.parse({ ...document, layers: [...document.layers, command.layer] });
        break;
      case "remove_layer":
        if (!document.layers.some((layer) => layer.id === command.layerId)) {
          throw new HveEditorCommandError("HVE_EDITOR_LAYER_NOT_FOUND", "The selected production layer no longer exists.");
        }
        document = clipDocumentV2Schema.parse({ ...document, layers: document.layers.filter((layer) => layer.id !== command.layerId) });
        break;
      case "set_text_layer": {
        const selected = document.layers.find((layer) => layer.id === command.layerId);
        if (!selected) {
          throw new HveEditorCommandError("HVE_EDITOR_LAYER_NOT_FOUND", "The selected text layer no longer exists.");
        }
        if (selected.type !== "text") {
          throw new HveEditorCommandError("HVE_EDITOR_LAYER_TYPE_MISMATCH", "Only a text layer can be changed by this command.");
        }
        document = clipDocumentV2Schema.parse({
          ...document,
          layers: document.layers.map((layer) => layer.id === command.layerId
            ? { ...layer, ...command.patch }
            : layer),
        });
        break;
      }
      case "set_caption_track":
        document = clipDocumentV2Schema.parse({
          ...document,
          captions: { ...document.captions, ...command.patch },
        });
        break;
      case "set_caption_style":
        document = clipDocumentV2Schema.parse({
          ...document,
          captions: { ...document.captions, style: { ...document.captions.style, ...command.patch } },
        });
        break;
      case "set_audio_policy":
        document = clipDocumentV2Schema.parse({ ...document, audio: audioPolicySchema.parse({ ...document.audio, ...command.patch }) });
        break;
      case "set_export_profile":
        document = clipDocumentV2Schema.parse({ ...document, export: command.profile });
        break;
      case "set_clip_metadata":
        throw new HveEditorCommandError("HVE_EDITOR_METADATA_REQUIRES_DRAFT", "Clip metadata must be applied through the full draft reducer.");
      default: {
        const exhaustive: never = command;
        throw new HveEditorCommandError("HVE_EDITOR_COMMAND_UNKNOWN", `Unsupported command ${String(exhaustive)}`);
      }
    }
  }
  return document;
}

/**
 * Pure reducer for the entire editor state. Metadata commands deliberately
 * share the command log and revision with media changes, while only media
 * changes contribute to the render document hash.
 */
export function applyEditorDraftCommands(input: {
  document: ClipDocumentV2;
  metadata: ClipDraftMetadata;
  commands: EditorCommand[];
}): { document: ClipDocumentV2; metadata: ClipDraftMetadata } {
  const document = clipDocumentV2Schema.parse(input.document);
  let metadata = clipDraftMetadataSchema.parse(input.metadata);
  const commands = input.commands.map((command) => editorCommandSchema.parse(command));
  assertUniqueCommandIds(commands);
  assertCommandClipIds(commands, document.clipId);
  const mediaCommands = commands.filter((command) => command.kind !== "set_clip_metadata");
  for (const command of commands) {
    if (command.kind === "set_clip_metadata") {
      metadata = clipDraftMetadataSchema.parse({ ...metadata, ...command.patch });
    }
  }
  return {
    document: applyEditorCommands(document, mediaCommands),
    metadata,
  };
}
