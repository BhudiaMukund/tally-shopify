/**
 * Where a whole captured product goes when it can't reach `/api/intake` right
 * now — airplane mode is the point of the exercise (BUILD_PLAN §10's "done
 * when"), so submission has to succeed with zero network, not just a flaky
 * one. A separate IndexedDB database from `src/lib/capture/offline-store.ts`
 * on purpose: that one holds photo *bytes* waiting to reach Garage, this one
 * holds the small, text-only rest of a submission (price, qty, barcode) plus
 * a pointer to each photo, so a draft can queue immediately even before any
 * of its photos have finished uploading.
 */

const DB_NAME = "tally-intake";
const DB_VERSION = 1;
const STORE_NAME = "pending-drafts";

/**
 * Either a photo that already has a real key, or a pointer to a blob still
 * sitting in `capture/offline-store.ts`'s `pending-photos` store, waiting for
 * its own upload to succeed on reconnect.
 */
export type QueuedPhoto =
  | { status: "uploaded"; key: string; url: string; width: number; height: number; bytes: number }
  | { status: "pending"; localId: string };

export interface QueuedDraft {
  /** The draft's own `scanId` — the idempotency key `/api/intake` keys on. */
  scanId: string;
  kind: "new_product" | "new_variant";
  barcodeRaw: string;
  price: string;
  qty: number;
  deviceId: string;
  vendor?: string;
  productType?: string;
  siblingOf?: string;
  parent?: { productId: string; productTitle: string; posOnly: boolean; optionName: string };
  photos: QueuedPhoto[];
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "scanId" });
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

export async function saveQueuedDraft(draft: QueuedDraft): Promise<void> {
  const db = await openDb();
  try {
    await runTransaction(db, "readwrite", (store) => store.put(draft));
  } finally {
    db.close();
  }
  await refreshCount();
}

/** Oldest first — captures should reach Shopify's queue in the order they happened. */
export async function listQueuedDrafts(): Promise<QueuedDraft[]> {
  const db = await openDb();
  try {
    const all = await runTransaction(db, "readonly", (store) => store.getAll());
    return [...all].sort((a, b) => a.queuedAt - b.queuedAt);
  } finally {
    db.close();
  }
}

export async function deleteQueuedDraft(scanId: string): Promise<void> {
  const db = await openDb();
  try {
    await runTransaction(db, "readwrite", (store) => store.delete(scanId));
  } finally {
    db.close();
  }
  await refreshCount();
}

/**
 * The "N waiting to sync" badge (BUILD_PLAN §10's "visible pending count in
 * the header") needs a synchronous snapshot for `useSyncExternalStore`, but
 * the real count lives in IndexedDB, which is async. Kept as an in-memory
 * cache that every write refreshes — good enough for a badge nobody reads at
 * microsecond precision, and it starts truthful on first subscribe rather
 * than waiting for the next save or delete.
 */
let cachedCount = 0;
const countListeners = new Set<() => void>();

function notifyCountChanged(): void {
  for (const listener of countListeners) listener();
}

async function refreshCount(): Promise<void> {
  cachedCount = (await listQueuedDrafts()).length;
  notifyCountChanged();
}

export function subscribeQueuedDraftCount(onChange: () => void): () => void {
  countListeners.add(onChange);
  if (countListeners.size === 1) void refreshCount();
  return () => countListeners.delete(onChange);
}

export function getQueuedDraftCountSnapshot(): number {
  return cachedCount;
}

export function getQueuedDraftCountServerSnapshot(): number {
  return 0;
}
