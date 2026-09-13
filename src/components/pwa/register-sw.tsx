"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`. Production only — a service worker caching the
 * shell in `next dev` fights HMR's own module invalidation, and there is
 * nothing to gain from testing it against a dev server that doesn't build
 * the hashed static assets it's meant to cache anyway.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
