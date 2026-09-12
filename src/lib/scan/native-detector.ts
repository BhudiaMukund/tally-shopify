import { NATIVE_FORMATS } from "./formats";
import type { DecodeOutcome } from "./zxing-client";

/**
 * The browser's own decoder, where there is one.
 *
 * Hardware-accelerated on Android, which is the whole reason to prefer it: it
 * decodes a 1080p frame in single-digit milliseconds where ZXing needs tens.
 * Everything here is feature-detected at runtime — the type declaration in
 * `src/types/barcode-detector.d.ts` makes it compile, not exist.
 */

function detectorConstructor(): typeof BarcodeDetector | undefined {
  if (typeof window === "undefined") return undefined;
  return typeof window.BarcodeDetector === "function" ? window.BarcodeDetector : undefined;
}

export function hasNativeDetector(): boolean {
  return detectorConstructor() !== undefined;
}

/**
 * Which symbologies this browser can actually read.
 *
 * Worth asking rather than assuming: Chrome on desktop Linux exposes the
 * constructor and supports nothing, and a detector that reads no formats fails
 * silently on every frame.
 */
export async function nativeSupportedFormats(): Promise<string[] | undefined> {
  const Constructor = detectorConstructor();
  if (Constructor === undefined) return undefined;
  try {
    return await Constructor.getSupportedFormats();
  } catch {
    return undefined;
  }
}

export interface NativeDetector {
  decode: (source: CanvasImageSource) => Promise<DecodeOutcome>;
  isBusy: () => boolean;
}

/**
 * Asks only for the formats this catalogue uses *and* the browser admits to
 * supporting. Passing an unsupported format makes the constructor throw, which
 * would take the scanner down over a symbology nobody scans.
 */
export function createNativeDetector(supported: readonly string[] | undefined): NativeDetector {
  const formats = NATIVE_FORMATS.filter(
    (format) => supported === undefined || supported.includes(format),
  );

  const Constructor = detectorConstructor();
  if (Constructor === undefined) throw new Error("This browser has no BarcodeDetector");

  const detector = new Constructor(formats.length > 0 ? { formats } : undefined);
  let busy = false;

  return {
    async decode(source: CanvasImageSource): Promise<DecodeOutcome> {
      busy = true;
      const startedAt = performance.now();

      try {
        const found = await detector.detect(source as ImageBitmapSource);
        const first = found[0];
        return {
          text: first?.rawValue ?? null,
          format: first?.format ?? null,
          ms: Math.round(performance.now() - startedAt),
        };
      } catch {
        // The detector rejects on a frame it cannot read — a zero-sized canvas
        // while the camera is still starting, most often. Not a barcode is the
        // right answer either way.
        return { text: null, format: null, ms: Math.round(performance.now() - startedAt) };
      } finally {
        busy = false;
      }
    },

    isBusy: () => busy,
  };
}
