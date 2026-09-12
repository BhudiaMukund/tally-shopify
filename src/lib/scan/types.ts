/**
 * What a scan is, independent of what read it.
 *
 * The point of the whole module: a component that consumes scans must not be
 * able to tell whether the camera, a USB scanner gun or someone typing produced
 * one. `source` exists for the debug panel and for the audit trail, never for a
 * branch in a screen.
 */

export type ScanSource =
  /** The browser's own `BarcodeDetector`. */
  | "native"
  /** ZXing in a worker, where `BarcodeDetector` is missing or forced off. */
  | "zxing"
  /** A keyboard-wedge scanner gun typing into a hidden field. */
  | "hid"
  /** Someone typed it in. */
  | "manual";

export interface ScanEvent {
  /** Digits, normalised. What a lookup or a write would use. */
  barcode: string;
  /** Exactly what the decoder returned, before normalisation. */
  raw: string;
  source: ScanSource;
  /** `Date.now()` at the moment of the read. */
  timestamp: number;
  /**
   * Time from starting work on the frame (or the first keystroke) to the
   * decode. On-screen in the debug panel, because remote debugging on the
   * shop phone does not work.
   */
  latencyMs: number;
  /** The symbology, where the decoder names one: `ean_13`, `code_128`. */
  format?: string;
}

/** The camera half of the scanner. HID and manual entry work in every state. */
export type CameraState =
  /** No camera has been asked for yet. */
  | "idle"
  /** `getUserMedia` is in flight — the permission prompt may be showing. */
  | "starting"
  /** Frames are arriving and being decoded. */
  | "running"
  /** The person said no, or the browser remembers them saying no. */
  | "denied"
  /** There is no camera, or the browser will not give us one here. */
  | "unavailable"
  /** Stopped deliberately: the tab is hidden, or a sheet is open. */
  | "stopped";

export type ScanEngine = "native" | "zxing";

/** Everything the on-screen debug panel shows. Cheap to keep, hard to get from a phone. */
export interface ScannerDiagnostics {
  engine: ScanEngine | null;
  /** Why that engine: forced by a query parameter, or what the browser supports. */
  engineReason: string;
  cameraState: CameraState;
  /** The resolution the camera actually gave us, not what we asked for. */
  resolution: string | null;
  /** The resolution frames are decoded at, after downscaling. */
  decodeResolution: string | null;
  /** Frames handed to a decoder in the last second. */
  decodeFps: number;
  /** Decode attempts since the camera started, and how many found something. */
  attempts: number;
  hits: number;
  /** The last decode's round trip, successful or not. */
  lastDecodeMs: number | null;
  /** The last value any source produced, even one the debounce swallowed. */
  lastRaw: string | null;
  lastSource: ScanSource | null;
  /** Why the last candidate was dropped: debounced, too short, typed too slowly. */
  lastRejection: string | null;
  /** HID keystroke timing from the last burst, so a scanner gun can be tuned. */
  hidMaxGapMs: number | null;
  /** Anything that failed loudly — a worker that would not start, a camera error. */
  error: string | null;
}
