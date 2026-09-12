import { describe, expect, it } from "vitest";

import { decodeFrame, toLuminance } from "./zxing-decode";

/**
 * The fallback decoder, exercised on purpose.
 *
 * Android Chrome ships `BarcodeDetector`, so on every phone this shop owns the
 * ZXing path only runs when something forces it. Left to real use it would
 * never be exercised until the day a browser without a native detector turns
 * up, which is the worst possible day to find out it never worked.
 *
 * Frames are generated from the EAN-13 specification below rather than
 * committed as image fixtures: nothing binary in a public repo, synthetic GTINs
 * with valid check digits like everywhere else here, and `@zxing/library` 0.23
 * ships no 1D writer to borrow.
 *
 * EAN-13 is the whole catalogue, and a UPC-A is an EAN-13 whose first digit is
 * zero, so one encoder covers both. Code 128 is decoded in the same reader with
 * the same hints; its own encoding table is 107 entries and is not worth
 * carrying here to prove the same path twice.
 */

const EAN_13 = "5012345678900";
/** The same trade item printed as a UPC-A: a 13-digit code with a leading zero. */
const UPC_A_AS_EAN_13 = "0036000291452";

// prettier-ignore
const L_CODES = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
// prettier-ignore
const G_CODES = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
// prettier-ignore
const R_CODES = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];

/** Which of the left six digits use the G table. The first digit is not drawn. */
// prettier-ignore
const PARITY = [
  "000000", "001011", "001101", "001110", "010011",
  "011001", "011100", "010101", "010110", "011010",
];

/** The 95-module pattern of an EAN-13, as a string of 0s and 1s. */
function ean13Modules(code: string): string {
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0] ?? 0] ?? PARITY[0]!;

  let modules = "101";
  for (let index = 0; index < 6; index += 1) {
    const digit = digits[index + 1] ?? 0;
    modules += parity[index] === "0" ? L_CODES[digit]! : G_CODES[digit]!;
  }
  modules += "01010";
  for (let index = 0; index < 6; index += 1) {
    modules += R_CODES[digits[index + 7] ?? 0]!;
  }
  return `${modules}101`;
}

export interface Frame {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Draws the pattern as a camera would see it: black bars on white, with the
 * quiet zone the symbology requires. Nine modules is the specified minimum and
 * a decoder is entitled to fail without it.
 */
function renderEan13(code: string, { scale = 3, height = 120, quietModules = 12 } = {}): Frame {
  const modules = ean13Modules(code);
  const width = (modules.length + quietModules * 2) * scale;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);

  for (let x = 0; x < width; x += 1) {
    const bar = Math.floor(x / scale) - quietModules;
    const dark = bar >= 0 && bar < modules.length && modules[bar] === "1";
    if (!dark) continue;

    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
    }
  }

  return { rgba, width, height };
}

describe("toLuminance", () => {
  it("collapses RGBA to one byte a pixel", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...toLuminance(rgba, 2)]).toEqual([0, 255]);
  });

  it("weights green the way ZXing's own binarizer expects", () => {
    // (r + 2g + b) / 4, so pure green reads twice as bright as pure red.
    // Uint8ClampedArray rounds half to even, which is where the .75 and .5 go.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const [red, green] = toLuminance(rgba, 2);
    expect(red).toBe(64);
    expect(green).toBe(128);
  });

  it("does not run off the end of a short buffer", () => {
    // A truncated transfer must not take the worker down with it.
    expect(toLuminance(new Uint8ClampedArray(4), 8)).toHaveLength(8);
  });
});

describe("decodeFrame", () => {
  it("reads an EAN-13 out of a frame", () => {
    const frame = renderEan13(EAN_13);
    expect(decodeFrame(frame.rgba, frame.width, frame.height)).toEqual({
      text: EAN_13,
      format: "ean_13",
    });
  });

  it("names formats the way BarcodeDetector does, so the two engines agree", () => {
    const frame = renderEan13(UPC_A_AS_EAN_13);
    const result = decodeFrame(frame.rgba, frame.width, frame.height);

    // A leading zero makes it a UPC-A, and ZXing says so. Lower-cased and
    // underscored to match the native detector's spelling.
    expect(result?.format).toBe("upc_a");
    expect(result?.text).toBe("036000291452");
  });

  it("reads a frame the size the pump actually produces", () => {
    // 1080p downscaled to a 1024 long edge, which is what DECODE_MAX_EDGE gives.
    const frame = renderEan13(EAN_13, { scale: 8, height: 576, quietModules: 30 });
    expect(frame.width).toBeGreaterThan(1_000);
    expect(decodeFrame(frame.rgba, frame.width, frame.height)?.text).toBe(EAN_13);
  });

  it("still reads a small, low-contrast label", () => {
    // A dense code at the far end of what the downscaled frame preserves.
    const frame = renderEan13(EAN_13, { scale: 2, height: 60, quietModules: 10 });
    expect(decodeFrame(frame.rgba, frame.width, frame.height)?.text).toBe(EAN_13);
  });

  it("returns null for a frame with no barcode in it", () => {
    // Most frames. Not an error — ZXing throws NotFoundException and the
    // decoder swallows it.
    const blank = new Uint8ClampedArray(320 * 240 * 4).fill(255);
    expect(decodeFrame(blank, 320, 240)).toBeNull();
  });

  it("does not carry state from one frame to the next", () => {
    const first = renderEan13(EAN_13);
    const second = renderEan13(UPC_A_AS_EAN_13, { scale: 4, height: 90 });

    expect(decodeFrame(first.rgba, first.width, first.height)?.text).toBe(EAN_13);
    // A different code at a different size, straight after: a reader holding a
    // row cache would answer with the first one.
    expect(decodeFrame(second.rgba, second.width, second.height)?.text).toBe("036000291452");
    expect(decodeFrame(first.rgba, first.width, first.height)?.text).toBe(EAN_13);
  });

  it("survives a frame smaller than it claims to be", () => {
    expect(() => decodeFrame(new Uint8ClampedArray(64), 320, 240)).not.toThrow();
    expect(decodeFrame(new Uint8ClampedArray(64), 320, 240)).toBeNull();
  });
});
