import type { ScanEngine } from "./types";

/**
 * Which decoder runs, and why.
 *
 * The "why" is not decoration. Android Chrome ships `BarcodeDetector`, so on
 * every phone this shop owns the ZXing path will never run by itself — and an
 * untested fallback is the same as no fallback. `?engine=zxing` forces it, and
 * the debug panel prints the reason so a tester can see which one they are
 * actually looking at.
 */

export type EngineRequest = "auto" | ScanEngine;

export function parseEngineRequest(value: string | null | undefined): EngineRequest {
  return value === "zxing" || value === "native" ? value : "auto";
}

export interface EngineChoice {
  engine: ScanEngine;
  /** One short sentence, shown verbatim in the debug panel. */
  reason: string;
}

export interface EngineInputs {
  requested: EngineRequest;
  /** `"BarcodeDetector" in window`, resolved by the caller. */
  hasNativeDetector: boolean;
  /** Formats `BarcodeDetector.getSupportedFormats()` reported, when it was asked. */
  nativeFormats?: readonly string[];
  /** The retail formats we need at least one of before native is worth using. */
  requiredFormats?: readonly string[];
}

/**
 * A native detector that cannot read EAN-13 is no use to a party shop, however
 * present it is. Chrome on desktop Linux is the real case: the API exists and
 * `getSupportedFormats()` comes back empty.
 */
export function resolveEngine({
  requested,
  hasNativeDetector,
  nativeFormats,
  requiredFormats = [],
}: EngineInputs): EngineChoice {
  if (requested === "zxing") {
    return { engine: "zxing", reason: "forced by ?engine=zxing" };
  }

  if (requested === "native") {
    return hasNativeDetector
      ? { engine: "native", reason: "forced by ?engine=native" }
      : { engine: "zxing", reason: "?engine=native asked for, but this browser has none" };
  }

  if (!hasNativeDetector) {
    return { engine: "zxing", reason: "no BarcodeDetector in this browser" };
  }

  if (nativeFormats !== undefined && requiredFormats.length > 0) {
    const usable = requiredFormats.filter((format) => nativeFormats.includes(format));
    if (usable.length === 0) {
      return {
        engine: "zxing",
        reason: `BarcodeDetector reads none of ${requiredFormats.join(", ")}`,
      };
    }
    return { engine: "native", reason: `BarcodeDetector reads ${usable.length} of our formats` };
  }

  return { engine: "native", reason: "BarcodeDetector available" };
}
