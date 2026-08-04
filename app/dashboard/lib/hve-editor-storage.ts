/**
 * Shared IndexedDB schema for browser-only HVE editor recovery data.
 *
 * All stores are deliberately local to the browser. The API draft stays the
 * authority; this database is only a durable, privacy-preserving outbox for
 * work that has not reached the API yet.
 */
export const hveEditorDatabaseName = "4short-hve-editor";
export const hveEditorDatabaseVersion = 2;

export const hveEditorStores = {
  recovery: "draft-recovery",
  commandQueue: "command-queue",
} as const;

export type HveEditorStoreName = typeof hveEditorStores[keyof typeof hveEditorStores];

export function hasHveEditorStorage() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(hveEditorDatabaseName, hveEditorDatabaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(hveEditorStores.recovery)) {
        database.createObjectStore(hveEditorStores.recovery, { keyPath: "clipId" });
      }
      if (!database.objectStoreNames.contains(hveEditorStores.commandQueue)) {
        const queue = database.createObjectStore(hveEditorStores.commandQueue, { keyPath: "batchId" });
        queue.createIndex("clipId", "clipId", { unique: false });
      } else {
        const queue = request.transaction?.objectStore(hveEditorStores.commandQueue);
        if (queue && !queue.indexNames.contains("clipId")) queue.createIndex("clipId", "clipId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("HVE_EDITOR_STORAGE_OPEN_FAILED"));
  });
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("HVE_EDITOR_STORAGE_REQUEST_FAILED"));
  });
}

export async function withHveEditorStore<T>(
  storeName: HveEditorStoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    return await requestResult(operation(database.transaction(storeName, mode).objectStore(storeName)));
  } finally {
    database.close();
  }
}
