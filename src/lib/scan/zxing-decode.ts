import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";

import { ZXING_FORMATS } from "./formats";

/**
 * The fallback decode itself, with no worker around it.
 *
 * Separated from `zxing.worker.ts` so it can be tested directly. The worker is
 * the hard part to reach from a test runner, and the decode is the part that
 * can quietly be wrong — Android Chrome has `BarcodeDetector`, so on every
 * phone this shop owns this code only ever runs when it is forced to, and an
 * untested fallback is the same as no fallback.
 *
 * Still never reaches the page bundle: only the worker imports this, and the
 * worker is its own chunk.
 */

/**
 * Trying harder is worth it here. This engine only runs where there is no
 * native detector, so it is already the slow path — and a fallback that reads
 * an angled label on the fourth frame beats one that never reads it at all.
 */
const TRY_HARDER = true;

function createReader(): MultiFormatReader {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();

  hints.set(
    DecodeHintType.POSSIBLE_FORMATS,
    ZXING_FORMATS.map((name) => BarcodeFormat[name]),
  );
  hints.set(DecodeHintType.TRY_HARDER, TRY_HARDER);

  reader.setHints(hints);
  return reader;
}

let reader: MultiFormatReader | null = null;

/**
 * RGBA → one luminance byte per pixel.
 *
 * `RGBLuminanceSource` only converts for an `Int32Array`; handed a
 * `Uint8ClampedArray` it takes the bytes as luminance already. Doing the
 * conversion here rather than on the main thread is the point of the worker,
 * and it uses ZXing's own green-favouring average so the binarizer sees what it
 * expects.
 */
export function toLuminance(rgba: Uint8ClampedArray, pixels: number): Uint8ClampedArray {
  const luminance = new Uint8ClampedArray(pixels);

  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const red = rgba[offset] ?? 0;
    const green = rgba[offset + 1] ?? 0;
    const blue = rgba[offset + 2] ?? 0;
    luminance[index] = (red + 2 * green + blue) / 4;
  }

  return luminance;
}

export interface ZxingDecodeResult {
  text: string;
  /** Lower-cased to match what `BarcodeDetector` reports, so the two agree. */
  format: string;
}

/**
 * Returns null for a frame with no barcode in it, which is most frames. That is
 * the normal answer, not an error — ZXing signals it by throwing
 * `NotFoundException`, which is why the catch here is silent.
 */
export function decodeFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ZxingDecodeResult | null {
  reader ??= createReader();

  try {
    const source = new RGBLuminanceSource(toLuminance(rgba, width * height), width, height);
    const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)));

    return {
      text: result.getText(),
      format: BarcodeFormat[result.getBarcodeFormat()].toLowerCase(),
    };
  } catch {
    return null;
  } finally {
    // The reader holds per-decode state; without this a 1D reader can carry a
    // row cache across frames of different sizes.
    reader.reset();
  }
}
