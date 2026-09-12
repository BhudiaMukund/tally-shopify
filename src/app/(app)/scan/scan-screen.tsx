"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { DebugPanel } from "@/components/scan/debug-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  getDebugPreference,
  getDebugPreferenceOnServer,
  setDebugPreference,
  subscribeToDebugPreference,
} from "@/lib/scan/debug-preference";
import type { EngineRequest } from "@/lib/scan/engine";
import { primeFeedback } from "@/lib/scan/feedback";
import type { ScanEvent } from "@/lib/scan/types";
import { useScanner } from "@/lib/scan/use-scanner";

/**
 * The scan screen: full-bleed viewfinder with everything else floating over it.
 *
 * One column, no tabs, one action within thumb reach — the phone is held at
 * arm's length in one hand while the other holds a box (BUILD_PLAN §4).
 *
 * What happens to a scan lands in commit 8. Here it is shown on screen, which
 * is both the proof the abstraction works and the only way to check a read on a
 * phone whose remote debugging does not work.
 */

/**
 * Radix Dialog is real weight (~14KB gzipped) and the manual-entry sheet is
 * not needed until someone taps for it — often never, if the camera is doing
 * its job. Deferred here rather than statically imported keeps it off the
 * scan route's 40KB own-code budget until it is actually opened.
 */
const ManualEntry = dynamic(
  () => import("@/components/scan/manual-entry").then((m) => m.ManualEntry),
  { ssr: false },
);

const SOURCE_LABEL = {
  native: "Camera",
  zxing: "Camera (fallback decoder)",
  hid: "Scanner gun",
  manual: "Typed",
} as const;

export interface ScanScreenProps {
  engine: EngineRequest;
  /** `?debug=1` opens the panel on load. The toggle is remembered after that. */
  debug: boolean;
}

export function ScanScreen({ engine, debug }: ScanScreenProps) {
  const [lastScan, setLastScan] = useState<ScanEvent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  // Mounted only once the sheet is asked for, so its ~14KB (Radix Dialog)
  // never touches the initial /scan bundle for the common case: the camera
  // works and nobody ever taps this.
  const [manualLoaded, setManualLoaded] = useState(false);
  const primed = useRef(false);

  const onScan = useCallback((event: ScanEvent) => setLastScan(event), []);
  // Destructured rather than kept as one object: `videoRef` makes the whole
  // return value look like a ref to the compiler's lint, and every read off it
  // is then a ref read during render.
  const {
    videoRef,
    cameraState,
    failure,
    locked,
    startCamera,
    submit,
    setHidEnabled,
    getDiagnostics,
  } = useScanner({ onScan, engine, paused: manualOpen });

  const showDebug = useSyncExternalStore(
    subscribeToDebugPreference,
    getDebugPreference,
    getDebugPreferenceOnServer,
  );

  /**
   * The camera starts on its own. Someone who opened /scan wants to scan, and
   * making them press a button first costs a tap on every single item.
   */
  useEffect(() => {
    startCamera();
  }, [startCamera]);

  /** The sheet traps focus and owns the keyboard while it is open. */
  useEffect(() => {
    setHidEnabled(!manualOpen);
  }, [manualOpen, setHidEnabled]);

  /** `?debug=1` seeds the preference; the toggle owns it from then on. */
  useEffect(() => {
    if (debug) setDebugPreference(true);
  }, [debug]);

  const toggleDebug = useCallback(() => {
    setDebugPreference(!getDebugPreference());
  }, []);

  /**
   * An `AudioContext` created outside a gesture starts suspended and stays
   * silent. The first touch anywhere on the screen is the gesture — the camera
   * permission prompt does not count as one.
   */
  const prime = useCallback(() => {
    if (primed.current) return;
    primed.current = true;
    primeFeedback();
  }, []);

  const cameraFailed = failure !== null;

  return (
    <main
      onPointerDown={prime}
      className="bg-ink fixed inset-0 flex flex-col overflow-hidden text-white"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        // Not `hidden`: a display:none video stops producing frames on some
        // Android builds, which would stall the decode loop rather than dim it.
        className={cn(
          "absolute inset-0 size-full object-cover",
          cameraState === "running" ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Legibility only. The chrome floats over whatever the shelf happens to
          look like, and white-on-white is unreadable under strip lighting. */}
      <div
        aria-hidden="true"
        className="from-ink/80 pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent"
      />
      <div
        aria-hidden="true"
        className="from-ink/85 pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t to-transparent"
      />

      <header className="relative z-20 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/"
          className="font-display -m-2 p-2 text-xl font-bold text-white font-stretch-95%"
        >
          Tally
        </Link>
        <button
          type="button"
          onClick={toggleDebug}
          aria-pressed={showDebug}
          className={cn(
            "flex h-11 items-center rounded-md px-3 text-sm font-medium",
            showDebug ? "bg-white/18 text-white" : "text-white/70",
          )}
        >
          Debug
        </button>
      </header>

      {showDebug ? <DebugPanel read={getDiagnostics} onClose={toggleDebug} /> : null}

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        {cameraFailed ? (
          <div className="bg-card text-ink w-full max-w-sm rounded-lg p-5">
            <h1 className="font-display text-xl font-bold">{failure?.title}</h1>
            <p className="text-ink-soft mt-2 text-sm">{failure?.instruction}</p>
            <Button
              variant="secondary"
              size="md"
              className="mt-4"
              onClick={() => {
                prime();
                startCamera();
              }}
            >
              Use camera
            </Button>
          </div>
        ) : (
          <>
            <Reticle locked={locked} />
            <p className="mt-5 text-center text-base text-white/85">
              {cameraState === "running" ? "Point at the barcode" : "Starting the camera…"}
            </p>
          </>
        )}
      </div>

      <div className="relative z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {lastScan === null ? null : (
          <div className="bg-card text-ink mb-3 rounded-lg px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-soft text-xs">{SOURCE_LABEL[lastScan.source]}</span>
              <span className="text-ink-soft font-mono text-xs tabular-nums">
                {lastScan.latencyMs}ms
              </span>
            </div>
            <p className="mt-1 font-mono text-2xl tabular-nums">{lastScan.barcode}</p>
          </div>
        )}

        <Button
          // The camera is the primary action on this screen while it works, and
          // it is not a button — so the accent goes to typing only when the
          // camera cannot carry the screen.
          variant={cameraFailed ? "primary" : "secondary"}
          size="touch"
          fullWidth
          onClick={() => {
            prime();
            setManualLoaded(true);
            setManualOpen(true);
          }}
        >
          Enter manually
        </Button>
      </div>

      {manualLoaded ? (
        <ManualEntry open={manualOpen} onOpenChange={setManualOpen} onSubmit={submit} />
      ) : null}
    </main>
  );
}

/**
 * The aiming rectangle: wide and short, because a retail barcode is.
 *
 * Corner brackets rather than a full frame — a closed rectangle reads as a
 * boundary the code must sit inside, and a 1D decoder only needs a line through
 * the bars.
 */
function Reticle({ locked }: { locked: boolean }) {
  return (
    <div
      data-motion="essential"
      className={cn(
        "relative aspect-[2.4/1] w-full max-w-sm rounded-lg border-2 transition-colors duration-150",
        locked ? "border-ok bg-ok/15 animate-tick" : "border-white/35",
      )}
    >
      {(
        [
          "left-0 top-0 border-l-3 border-t-3 rounded-tl-lg",
          "right-0 top-0 border-r-3 border-t-3 rounded-tr-lg",
          "left-0 bottom-0 border-l-3 border-b-3 rounded-bl-lg",
          "right-0 bottom-0 border-r-3 border-b-3 rounded-br-lg",
        ] as const
      ).map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          className={cn(
            "absolute size-7 transition-colors duration-150",
            locked ? "border-ok" : "border-white",
            corner,
          )}
        />
      ))}
    </div>
  );
}
