/**
 * Where a photo goes when it can't reach Garage — "retry twice then keep the
 * blob in IndexedDB and mark the draft incomplete rather than losing the
 * photo" (BUILD_PLAN §9). A photo taken on a phone with the wifi down is the
 * one thing that must never just vanish; a memory-only queue does not survive
 * the tab being closed, which is exactly when someone walks away mid-shift.
 */

const DB_NAME = "tally-capture";
const DB_VERSION = 1;
const STORE_NAME = "pending-photos";

export interface StoredPhoto {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  capturedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function savePendingPhoto(photo: StoredPhoto): Promise<void> {
  const db = await openDb();
  try {
    await runTransaction(db, "readwrite", (store) => store.put(photo));
  } finally {
    db.close();
  }
}

export async function listPendingPhotos(): Promise<StoredPhoto[]> {
  const db = await openDb();
  try {
    return await runTransaction(db, "readonly", (store) => store.getAll());
  } finally {
    db.close();
  }
}

export async function deletePendingPhoto(id: string): Promise<void> {
  const db = await openDb();
  try {
    await runTransaction(db, "readwrite", (store) => store.delete(id));
  } finally {
    db.close();
  }
}
