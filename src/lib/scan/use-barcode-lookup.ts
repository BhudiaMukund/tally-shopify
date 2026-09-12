"use client";

import { useCallback, useRef, useState } from "react";

import { fetchLookup, type LookupResponse } from "./lookup-client";

/**
 * Two requests per scan, not one — mirroring `src/lib/catalog/lookup.ts`
 * server-side, but over the network instead of in one process.
 *
 * `cachedOnly=1` answers from the mirror alone and is meant to land inside the
 * <100ms first-paint budget (BUILD_PLAN §1); the second, full request carries
 * the live Shopify answer a few hundred ms later. Once the first is `ready`,
 * later phases only refresh `reconciling` — the screen a person is already
 * looking at should not have its product list swapped out from under a tap in
 * progress.
 */

export type LookupPhase = "idle" | "loading" | "ready";

export interface BarcodeLookupState {
  phase: LookupPhase;
  barcode: string | null;
  data: LookupResponse | null;
  /** The cached answer painted; the live one has not landed yet. */
  reconciling: boolean;
  error: string | null;
}

const IDLE_STATE: BarcodeLookupState = {
  phase: "idle",
  barcode: null,
  data: null,
  reconciling: false,
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export interface UseBarcodeLookup {
  state: BarcodeLookupState;
  /** Starts a lookup for a freshly scanned barcode, cancelling any lookup in flight. */
  lookup: (barcode: string) => void;
  reset: () => void;
}

export function useBarcodeLookup(): UseBarcodeLookup {
  const [state, setState] = useState<BarcodeLookupState>(IDLE_STATE);
  const tokenRef = useRef(0);
  const controllers = useRef<AbortController[]>([]);

  const cancelInFlight = useCallback(() => {
    for (const controller of controllers.current) controller.abort();
    controllers.current = [];
  }, []);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    cancelInFlight();
    // `data` and `error` are left as they were rather than cleared: the sheet
    // built on this state closes with an animation, and clearing them here
    // would flash a spinner over whatever was on screen for the moment it
    // takes to slide away. The next `lookup()` call is what actually needs a
    // clean slate, and it sets `data: null` itself.
    setState((previous) => ({ ...previous, phase: "idle" }));
  }, [cancelInFlight]);

  const lookup = useCallback(
    (barcode: string) => {
      tokenRef.current += 1;
      const token = tokenRef.current;
      cancelInFlight();

      const fast = new AbortController();
      const full = new AbortController();
      controllers.current = [fast, full];

      setState({ phase: "loading", barcode, data: null, reconciling: false, error: null });

      void fetchLookup(barcode, { cachedOnly: true, signal: fast.signal })
        .then((data) => {
          if (tokenRef.current !== token) return;
          setState((previous) =>
            previous.phase === "ready"
              ? previous
              : { phase: "ready", barcode, data, reconciling: true, error: null },
          );
        })
        .catch(() => {
          // The fast phase is an optimisation. The full request below still answers.
        });

      void fetchLookup(barcode, { signal: full.signal })
        .then((data) => {
          if (tokenRef.current !== token) return;
          setState({ phase: "ready", barcode, data, reconciling: false, error: null });
        })
        .catch((error: unknown) => {
          if (tokenRef.current !== token || isAbort(error)) return;
          setState((previous) => ({
            ...previous,
            phase: "ready",
            reconciling: false,
            error: errorMessage(error),
          }));
        });
    },
    [cancelInFlight],
  );

  return { state, lookup, reset };
}
