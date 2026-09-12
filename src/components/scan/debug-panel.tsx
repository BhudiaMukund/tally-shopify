"use client";

import { useEffect, useState } from "react";

import type { ScannerDiagnostics } from "@/lib/scan/types";

/**
 * The only diagnostic channel this phone has.
 *
 * Remote debugging does not work on the shop's device, so everything that would
 * normally be a console line has to be legible at arm's length under
 * fluorescent light: which decoder is actually running, what it last read, and
 * how long the decode took.
 *
 * It polls rather than re-rendering per frame. The decode loop runs at 10fps
 * and keeps its counters in a ref precisely so the viewfinder is not re-rendered
 * ten times a second for numbers nobody is looking at; four updates a second is
 * plenty to read.
 */

const POLL_MS = 250;

const ENGINE_LABEL = {
  native: "BarcodeDetector (native)",
  zxing: "ZXing (fallback, worker)",
} as const;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-white/55">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-white tabular-nums">{value}</dd>
    </div>
  );
}

export interface DebugPanelProps {
  read: () => ScannerDiagnostics;
  onClose: () => void;
}

export function DebugPanel({ read, onClose }: DebugPanelProps) {
  const [snapshot, setSnapshot] = useState<ScannerDiagnostics>(read);

  useEffect(() => {
    const timer = setInterval(() => setSnapshot(read()), POLL_MS);
    return () => clearInterval(timer);
  }, [read]);

  const engine = snapshot.engine === null ? "deciding…" : ENGINE_LABEL[snapshot.engine];

  return (
    <section
      // Dark on dark: this floats over a camera feed, and a white panel would
      // wreck the exposure the viewfinder is showing.
      className="bg-ink/92 pointer-events-auto absolute inset-x-3 top-16 z-30 rounded-lg p-3 text-xs backdrop-blur-sm"
      aria-label="Scanner diagnostics"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-medium text-white">Scanner</h2>
        <button
          type="button"
          onClick={onClose}
          className="-m-2 flex size-11 items-center justify-center rounded-md text-white/70 hover:text-white"
        >
          <span className="sr-only">Hide diagnostics</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
            <path
              d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <dl className="divide-y divide-white/10">
        <Row label="engine" value={engine} />
        <Row label="why" value={snapshot.engineReason} />
        <Row label="camera" value={snapshot.cameraState} />
        <Row label="stream" value={snapshot.resolution ?? "—"} />
        <Row label="decode at" value={snapshot.decodeResolution ?? "—"} />
        <Row label="fps" value={`${snapshot.decodeFps}`} />
        <Row
          label="decode"
          value={snapshot.lastDecodeMs === null ? "—" : `${snapshot.lastDecodeMs}ms`}
        />
        <Row label="frames" value={`${snapshot.attempts} tried, ${snapshot.hits} read`} />
        <Row label="last value" value={snapshot.lastRaw ?? "—"} />
        <Row label="from" value={snapshot.lastSource ?? "—"} />
        <Row label="dropped" value={snapshot.lastRejection ?? "—"} />
        <Row
          label="hid gap"
          value={snapshot.hidMaxGapMs === null ? "—" : `${Math.round(snapshot.hidMaxGapMs)}ms`}
        />
        {snapshot.error === null ? null : <Row label="error" value={snapshot.error} />}
      </dl>

      <p className="mt-2 text-white/45">
        Add <span className="font-mono">?engine=zxing</span> to force the fallback decoder.
      </p>
    </section>
  );
}
