"use client";

import { useEffect, useSyncExternalStore } from "react";

import { flushOfflineQueue } from "./flush-offline-queue";
import {
  getQueuedDraftCountServerSnapshot,
  getQueuedDraftCountSnapshot,
  subscribeQueuedDraftCount,
} from "./offline-queue";

/**
 * The "N waiting to sync" badge (BUILD_PLAN §10) and the thing that actually
 * drains the queue on reconnect. No toast on a background flush — the badge
 * count dropping to zero is the confirmation, and pulling in `ToastProvider`
 * (Radix) just to narrate that would cost `/scan` bundle it does not need to
 * spend (see `scan-result-sheet.tsx`'s reasoning for deferring the same
 * dependency).
 */
export function usePendingIntakeCount(): number {
  useEffect(() => {
    function flush() {
      void flushOfflineQueue();
    }

    if (navigator.onLine) flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  return useSyncExternalStore(
    subscribeQueuedDraftCount,
    getQueuedDraftCountSnapshot,
    getQueuedDraftCountServerSnapshot,
  );
}
