import type { EditorCommand } from "@/packages/contracts/src/index";
import { hasHveEditorStorage, hveEditorStores, withHveEditorStore } from "./hve-editor-storage";

/**
 * A durable, append-only browser outbox for one server draft identity.
 *
 * Commands are never replayed onto a later draft. That would make a local
 * offline edit silently overwrite another tab's work. A caller must surface
 * an explicit conflict flow when `offlineBatchMatchesDraft` is false.
 */
export type HveOfflineCommandBatch = {
  schemaVersion: 1;
  batchId: string;
  clipId: string;
  baseVersion: number;
  baseRevision: number;
  documentHash: string;
  commands: EditorCommand[];
  createdAt: string;
  lastError: string | null;
};

export type HveDraftIdentity = {
  clipId: string;
  baseVersion: number;
  revision: number;
  documentHash: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOfflineBatch(value: unknown): value is HveOfflineCommandBatch {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && typeof value.batchId === "string"
    && typeof value.clipId === "string"
    && Number.isInteger(value.baseVersion)
    && Number.isInteger(value.baseRevision)
    && typeof value.documentHash === "string"
    && Array.isArray(value.commands)
    && value.commands.length > 0
    && typeof value.createdAt === "string"
    && (value.lastError === null || typeof value.lastError === "string");
}

export function offlineBatchMatchesDraft(batch: HveOfflineCommandBatch, draft: HveDraftIdentity) {
  return batch.clipId === draft.clipId
    && batch.baseVersion === draft.baseVersion
    && batch.baseRevision === draft.revision
    && batch.documentHash === draft.documentHash;
}

export async function enqueueHveOfflineCommandBatch(batch: HveOfflineCommandBatch) {
  if (!hasHveEditorStorage()) return false;
  await withHveEditorStore(hveEditorStores.commandQueue, "readwrite", (store) => store.put(batch));
  return true;
}

export async function readHveOfflineCommandBatches(clipId: string): Promise<HveOfflineCommandBatch[]> {
  if (!hasHveEditorStorage()) return [];
  const records = await withHveEditorStore(hveEditorStores.commandQueue, "readonly", (store) => store.index("clipId").getAll(clipId));
  return records.filter(isOfflineBatch).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function removeHveOfflineCommandBatch(batchId: string) {
  if (!hasHveEditorStorage()) return false;
  await withHveEditorStore(hveEditorStores.commandQueue, "readwrite", (store) => store.delete(batchId));
  return true;
}

export async function markHveOfflineCommandBatchError(batchId: string, message: string) {
  if (!hasHveEditorStorage()) return false;
  const existing = await withHveEditorStore(hveEditorStores.commandQueue, "readonly", (store) => store.get(batchId));
  if (!isOfflineBatch(existing)) return false;
  await withHveEditorStore(hveEditorStores.commandQueue, "readwrite", (store) => store.put({ ...existing, lastError: message }));
  return true;
}
