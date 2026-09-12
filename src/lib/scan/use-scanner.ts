"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  cameraSupported,
  closeCamera,
  describeCameraFailure,
  openCamera,
  streamResolution,
  type CameraFailure,
} from "./camera";
import { parseEngineRequest, resolveEngine, type EngineRequest } from "./engine";
import { confirmScan } from "./feedback";
import { REQUIRED_NATIVE_FORMATS } from "./formats";
import { cleanScanValue, createScanGate, DEBOUNCE_MS } from "./gate";
import { createHidDetector } from "./hid";
import {
  createNativeDetector,
  hasNativeDetector,
  nativeSupportedFormats,
  type NativeDetector,
} from "./native-detector";
import type { CameraState, ScanEvent, ScannerDiagnostics, ScanSource } from "./types";
import { createZxingClient, type DecodeOutcome, type ZxingClient } from "./zxing-client";

/**
 * One scanner, four sources, one event.
 *
 * A screen using this cannot tell whether the camera, a scanner gun or a person
 * produced a barcode, and that is the point: swapping the phone for a USB gun
 * later should be plugging it in, not rewriting the scan flow.
 *
 * The decode loop deliberately keeps nothing in React state. At 10fps a
 * `setState` per frame would re-render the viewfinder ten times a second for
 * numbers only the debug panel reads, so counters live in a ref and the panel
 * polls them.
 */

/** ~10fps. Faster does not read more barcodes; it only warms the phone up. */
export const FRAME_INTERVAL_MS = 100;

/**
 * The long edge of the frame handed to a decoder.
 *
 * A compromise, and worth naming as one. Full 1080p frames cost ZXing far more
 * than they gain, and dropping to 640 loses a dense EAN-13 at arm's length.
 * 1024 keeps roughly two pixels per narrow bar at the distance people actually
 * hold a phone from a shelf.
 */
export const DECODE_MAX_EDGE = 1024;

/** How long the lock flash stays up. Long enough to see, short enough not to block. */
const LOCK_MS = 320;

export interface UseScannerOptions {
  /** Called once per accepted scan, whatever read it. */
  onScan: (event: ScanEvent) => void;
  /** `?engine=` from the URL, or an env default. */
  engine?: EngineRequest;
  /** Stops decoding and HID capture without tearing the camera down. */
  paused?: boolean;
  debounceMs?: number;
}

export interface Scanner {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraState: CameraState;
  /** Set when the camera could not start. Carries the instruction to show. */
  failure: CameraFailure | null;
  /** True for a moment after a scan is accepted. Drives the lock flash. */
  locked: boolean;
  startCamera: () => void;
  stopCamera: () => void;
  /** Feeds a barcode in by hand. Returns false when the debounce swallowed it. */
  submit: (raw: string, source?: ScanSource) => boolean;
  /** Pauses HID capture while a real text field has focus. */
  setHidEnabled: (enabled: boolean) => void;
  /** A snapshot for the debug panel. Read on a timer, never rendered per frame. */
  getDiagnostics: () => ScannerDiagnostics;
}

const EMPTY_DIAGNOSTICS: ScannerDiagnostics = {
  engine: null,
  engineReason: "not decided yet",
  cameraState: "idle",
  resolution: null,
  decodeResolution: null,
  decodeFps: 0,
  attempts: 0,
  hits: 0,
  lastDecodeMs: null,
  lastRaw: null,
  lastSource: null,
  lastRejection: null,
  hidMaxGapMs: null,
  error: null,
};

/** True when the keys are going into a field someone is typing in. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useScanner({
  onScan,
  engine: requestedEngine = "auto",
  paused = false,
  debounceMs = DEBOUNCE_MS,
}: UseScannerOptions): Scanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [locked, setLocked] = useState(false);

  /**
   * The latest callback and the latest pause flag, reachable from the decode
   * loop without it being rebuilt — a pump that restarted whenever the parent
   * re-rendered would drop a frame each time.
   *
   * Synced in an effect rather than assigned during render: a render can be
   * thrown away and re-run, and a ref written during one that never commits is
   * a lie the loop would then act on.
   */
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const diagnostics = useRef<ScannerDiagnostics>({ ...EMPTY_DIAGNOSTICS });
  /**
   * Created once for the life of the hook. `useState` with an initialiser
   * rather than `useRef(create())`, which would build a new one on every render
   * and throw it away — and the gate's whole job is remembering.
   */
  const [gate] = useState(() => createScanGate(debounceMs));
  const [hid] = useState(() => createHidDetector());
  const hidEnabled = useRef(true);

  const stream = useRef<MediaStream | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const context2d = useRef<CanvasRenderingContext2D | null>(null);
  const nativeDetector = useRef<NativeDetector | null>(null);
  const zxing = useRef<ZxingClient | null>(null);
  const frameHandle = useRef<number | null>(null);
  const usingVideoFrameCallback = useRef(false);
  const lastFrameAt = useRef(0);
  const recentDecodes = useRef<number[]>([]);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  /**
   * `getUserMedia` is in flight.
   *
   * `running` alone is not enough: it only becomes true once the promise
   * resolves, so two calls inside that window both open a camera and the second
   * loses with `NotReadableError` — which then paints "another app is using the
   * camera" over a camera that is working perfectly. Two calls happen in
   * practice: React runs effects twice in development, and a person can tap
   * Use camera twice.
   */
  const starting = useRef(false);

  /**
   * The single funnel every source goes through.
   *
   * Debounce, confirmation and the event shape all live here, so a barcode read
   * by the camera and one typed by hand are indistinguishable downstream — and
   * so nobody can add a fifth source that quietly skips the debounce.
   */
  const emit = useCallback(
    (raw: string, source: ScanSource, format: string | undefined, latencyMs: number): boolean => {
      const value = cleanScanValue(raw);
      const snapshot = diagnostics.current;
      snapshot.lastRaw = raw;
      snapshot.lastSource = source;
      snapshot.lastDecodeMs = latencyMs;

      if (value === "") {
        snapshot.lastRejection = "empty";
        return false;
      }
      if (!gate.accept(value)) {
        snapshot.lastRejection = `debounced (${debounceMs}ms)`;
        return false;
      }

      snapshot.lastRejection = null;
      snapshot.hits += 1;

      confirmScan();
      setLocked(true);
      if (lockTimer.current !== null) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => setLocked(false), LOCK_MS);

      onScanRef.current({
        barcode: value,
        raw,
        source,
        timestamp: Date.now(),
        latencyMs,
        ...(format === undefined ? {} : { format }),
      });
      return true;
    },
    [debounceMs, gate],
  );

  /** Decides which engine runs, once, as early as possible. */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supported = await nativeSupportedFormats();
      if (cancelled) return;

      const choice = resolveEngine({
        requested: requestedEngine,
        hasNativeDetector: hasNativeDetector(),
        nativeFormats: supported,
        requiredFormats: REQUIRED_NATIVE_FORMATS,
      });

      diagnostics.current.engine = choice.engine;
      diagnostics.current.engineReason = choice.reason;

      try {
        if (choice.engine === "native") {
          nativeDetector.current = createNativeDetector(supported);
        } else {
          zxing.current ??= createZxingClient();
        }
      } catch (error) {
        diagnostics.current.error =
          error instanceof Error ? error.message : "the decoder would not start";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedEngine]);

  /** One canvas for the whole session, reused every frame. */
  const ensureCanvas = useCallback((): CanvasRenderingContext2D | null => {
    if (context2d.current !== null) return context2d.current;

    const element = document.createElement("canvas");
    // `getImageData` on every ZXing frame is exactly the access pattern this
    // hint exists for; without it the browser keeps the surface on the GPU and
    // pays a readback each time.
    const context = element.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;

    canvas.current = element;
    context2d.current = context;
    return context;
  }, []);

  const decodeFrame = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    const context = ensureCanvas();
    const surface = canvas.current;
    if (video === null || context === null || surface === null) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return;

    const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    if (surface.width !== targetWidth || surface.height !== targetHeight) {
      surface.width = targetWidth;
      surface.height = targetHeight;
    }
    context.drawImage(video, 0, 0, targetWidth, targetHeight);

    const snapshot = diagnostics.current;
    snapshot.decodeResolution = `${targetWidth}x${targetHeight}`;
    snapshot.attempts += 1;

    const now = performance.now();
    recentDecodes.current.push(now);
    while ((recentDecodes.current[0] ?? now) < now - 1_000) recentDecodes.current.shift();
    snapshot.decodeFps = recentDecodes.current.length;

    let outcome: DecodeOutcome;
    let source: ScanSource;

    if (nativeDetector.current !== null) {
      source = "native";
      outcome = await nativeDetector.current.decode(surface);
    } else if (zxing.current !== null) {
      source = "zxing";
      outcome = await zxing.current.decode(context.getImageData(0, 0, targetWidth, targetHeight));
    } else {
      return;
    }

    snapshot.lastDecodeMs = outcome.ms;
    if (outcome.text === null) return;

    emit(outcome.text, source, outcome.format ?? undefined, outcome.ms);
  }, [emit, ensureCanvas]);

  /**
   * The frame pump.
   *
   * `requestVideoFrameCallback` fires once per *decoded video frame* rather than
   * once per paint, so it never runs on a stalled camera and never decodes the
   * same frame twice. Firefox has no such thing, hence the animation-frame
   * fallback; both are throttled to the same interval.
   */
  const pump = useCallback(() => {
    const video = videoRef.current;
    if (video === null) return;

    // A declaration rather than a `const`, so it can schedule itself without
    // reading a binding that is not initialised yet.
    function step(): void {
      if (!running.current) return;

      const schedule = () => {
        if (!running.current || video === null) return;
        frameHandle.current = usingVideoFrameCallback.current
          ? video.requestVideoFrameCallback(() => step())
          : requestAnimationFrame(() => step());
      };

      const now = performance.now();
      const decoderBusy =
        nativeDetector.current?.isBusy() === true || zxing.current?.isBusy() === true;

      // Skipping a frame is always better than queueing one: a decode that
      // lands late only answers where the barcode used to be.
      if (pausedRef.current || decoderBusy || now - lastFrameAt.current < FRAME_INTERVAL_MS) {
        schedule();
        return;
      }

      lastFrameAt.current = now;
      void decodeFrame().finally(schedule);
    }

    step();
  }, [decodeFrame]);

  const stopCamera = useCallback(() => {
    running.current = false;
    if (frameHandle.current !== null) {
      if (usingVideoFrameCallback.current) {
        videoRef.current?.cancelVideoFrameCallback(frameHandle.current);
      } else {
        cancelAnimationFrame(frameHandle.current);
      }
      frameHandle.current = null;
    }

    closeCamera(stream.current);
    stream.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;

    setCameraState((previous) => (previous === "running" ? "stopped" : previous));
    diagnostics.current.cameraState = "stopped";
    diagnostics.current.resolution = null;
  }, []);

  const startCamera = useCallback(() => {
    if (running.current || starting.current) return;

    if (!cameraSupported()) {
      const problem: CameraFailure = {
        state: "unavailable",
        title: "This page cannot open a camera",
        instruction:
          "A camera needs https. Type the barcode to carry on, or open Tally over https.",
        detail: "insecure context or no mediaDevices",
      };
      setFailure(problem);
      setCameraState("unavailable");
      diagnostics.current.cameraState = "unavailable";
      return;
    }

    starting.current = true;
    setFailure(null);
    setCameraState("starting");
    diagnostics.current.cameraState = "starting";

    void (async () => {
      try {
        const media = await openCamera();
        const video = videoRef.current;
        if (video === null) {
          closeCamera(media);
          return;
        }

        stream.current = media;
        video.srcObject = media;
        // `playsInline` is set on the element; without it iOS Safari takes the
        // video fullscreen and the overlay disappears behind it.
        await video.play();

        running.current = true;
        usingVideoFrameCallback.current = typeof video.requestVideoFrameCallback === "function";
        lastFrameAt.current = 0;

        setCameraState("running");
        // An earlier attempt's instruction must not outlive the attempt that
        // worked.
        setFailure(null);
        diagnostics.current.cameraState = "running";
        diagnostics.current.resolution = streamResolution(media);
        diagnostics.current.error = null;

        pump();
      } catch (error) {
        const problem = describeCameraFailure(error);
        setFailure(problem);
        setCameraState(problem.state);
        diagnostics.current.cameraState = problem.state;
        diagnostics.current.error = problem.detail;
      } finally {
        starting.current = false;
      }
    })();
  }, [pump]);

  /**
   * HID capture, on `window` rather than a hidden focused input.
   *
   * A focused input is the usual trick and it is wrong on this device: focusing
   * one on Android raises the on-screen keyboard over the viewfinder, and
   * `inputmode="none"` only suppresses it on some versions. A keyboard-wedge
   * scanner's keystrokes bubble to `window` whether or not anything is focused,
   * so listening here reads the gun without touching focus at all.
   *
   * The trade is that keys meant for a real field would be seen twice, which is
   * what `isEditableTarget` is for: while someone is typing in the manual-entry
   * box, the gun's output belongs to that box.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pausedRef.current || !hidEnabled.current) return;
      if (isEditableTarget(event.target)) return;

      const result = hid.push(event.key, event.timeStamp || performance.now());
      if (result.type === "none") return;

      diagnostics.current.hidMaxGapMs = result.maxGapMs;

      if (result.type === "rejected") {
        diagnostics.current.lastRaw = result.value;
        diagnostics.current.lastSource = "hid";
        diagnostics.current.lastRejection = `hid ${result.reason}`;
        return;
      }

      // A gun ends with Enter; letting that reach a form would submit it.
      event.preventDefault();
      emit(result.value, "hid", undefined, result.durationMs);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [emit, hid]);

  /** Give the camera back when the tab goes away — Android will take it anyway. */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && running.current) stopCamera();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopCamera]);

  useEffect(() => {
    return () => {
      running.current = false;
      closeCamera(stream.current);
      stream.current = null;
      zxing.current?.terminate();
      zxing.current = null;
      if (lockTimer.current !== null) clearTimeout(lockTimer.current);
    };
  }, []);

  const submit = useCallback(
    (raw: string, source: ScanSource = "manual") => emit(raw, source, undefined, 0),
    [emit],
  );

  const setHidEnabled = useCallback(
    (enabled: boolean) => {
      hidEnabled.current = enabled;
      if (!enabled) hid.reset();
    },
    [hid],
  );

  const getDiagnostics = useCallback((): ScannerDiagnostics => ({ ...diagnostics.current }), []);

  return {
    videoRef,
    cameraState,
    failure,
    locked,
    startCamera,
    stopCamera,
    submit,
    setHidEnabled,
    getDiagnostics,
  };
}

export { parseEngineRequest };
