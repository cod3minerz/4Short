import type { ClipEditorState } from "../types";
import { hasHveEditorStorage, hveEditorStores, withHveEditorStore } from "./hve-editor-storage";

/**
 * A small, browser-only recovery cache for unsent HVE editor intent.
 *
 * The server draft remains the source of truth. This record is accepted only
 * when its document hash, base version and draft revision still match the
 * freshly fetched server draft; otherwise the UI must ask the user to resolve
 * a conflict rather than replaying commands into a different document.
 */
export type HveDraftRecovery = {
  schemaVersion: 1;
  clipId: string;
  documentHash: string;
  baseVersion: number;
  revision: number;
  state: ClipEditorState;
  wordEdits: Record<string, string>;
  hiddenWords: string[];
  cutWords: string[];
  updatedAt: string;
};

export async function readHveDraftRecovery(clipId: string): Promise<HveDraftRecovery | null> {
  if (!hasHveEditorStorage()) return null;
  return (await withHveEditorStore(hveEditorStores.recovery, "readonly", (store) => store.get(clipId))) ?? null;
}

export async function saveHveDraftRecovery(recovery: HveDraftRecovery) {
  if (!hasHveEditorStorage()) return false;
  await withHveEditorStore(hveEditorStores.recovery, "readwrite", (store) => store.put(recovery));
  return true;
}

export async function clearHveDraftRecovery(clipId: string) {
  if (!hasHveEditorStorage()) return false;
  await withHveEditorStore(hveEditorStores.recovery, "readwrite", (store) => store.delete(clipId));
  return true;
}

export function recoveryMatchesDraft(
  recovery: HveDraftRecovery,
  draft: { clipId: string; documentHash: string; baseVersion: number; revision: number },
) {
  return recovery.clipId === draft.clipId
    && recovery.documentHash === draft.documentHash
    && recovery.baseVersion === draft.baseVersion
    && recovery.revision === draft.revision;
}
