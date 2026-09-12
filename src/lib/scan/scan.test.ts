import { describe, expect, it } from "vitest";

import { parseEngineRequest, resolveEngine } from "./engine";
import { REQUIRED_NATIVE_FORMATS } from "./formats";
import { createScanGate, dedupeKey, DEBOUNCE_MS } from "./gate";
import { createHidDetector, HID_MAX_GAP_MS } from "./hid";

/** Synthetic GTINs with valid check digits, as everywhere else in this repo. */
const EAN_13 = "5012345678900";
const UPC_A = "036000291452";
const UPC_A_AS_EAN_13 = "0036000291452";

describe("dedupeKey", () => {
  it("treats a UPC-A and its EAN-13 spelling as one barcode", () => {
    expect(dedupeKey(UPC_A)).toBe(dedupeKey(UPC_A_AS_EAN_13));
  });

  it("keeps a non-numeric symbology as its own text", () => {
    expect(dedupeKey("CARTON-8842/A")).toBe("CARTON-8842/A");
  });
});

describe("createScanGate", () => {
  it("passes the first read of a barcode", () => {
    expect(createScanGate().accept(EAN_13, 1_000)).toBe(true);
  });

  it("swallows the camera reading the same code ten times a second", () => {
    const gate = createScanGate();
    expect(gate.accept(EAN_13, 0)).toBe(true);

    for (let at = 100; at < DEBOUNCE_MS; at += 100) {
      expect(gate.accept(EAN_13, at)).toBe(false);
    }
  });

  it("lets the same barcode through once the window has passed", () => {
    const gate = createScanGate();
    gate.accept(EAN_13, 0);
    expect(gate.accept(EAN_13, DEBOUNCE_MS)).toBe(true);
  });

  it("does not make a second item wait for the first", () => {
    // Working along a shelf is A, B, C — not one scan.
    const gate = createScanGate();
    expect(gate.accept(EAN_13, 0)).toBe(true);
    expect(gate.accept(UPC_A, 50)).toBe(true);
    expect(gate.accept("96385074", 100)).toBe(true);
  });

  it("still suppresses a repeat when another barcode came between", () => {
    const gate = createScanGate();
    gate.accept(EAN_13, 0);
    gate.accept(UPC_A, 50);
    expect(gate.accept(EAN_13, 100)).toBe(false);
  });

  it("suppresses the same code read under two different spellings", () => {
    const gate = createScanGate();
    expect(gate.accept(UPC_A, 0)).toBe(true);
    // The next frame decoded the same printed code as an EAN-13.
    expect(gate.accept(UPC_A_AS_EAN_13, 80)).toBe(false);
  });

  it("refuses a value with nothing in it", () => {
    expect(createScanGate().accept("   ", 0)).toBe(false);
  });

  it("forgets everything on reset, so the next screen starts clean", () => {
    const gate = createScanGate();
    gate.accept(EAN_13, 0);
    gate.reset();
    expect(gate.accept(EAN_13, 10)).toBe(true);
  });
});

describe("createHidDetector", () => {
  /** Types a string at a fixed interval and presses Enter. */
  function type(detector: ReturnType<typeof createHidDetector>, value: string, gapMs: number) {
    let at = 1_000;
    for (const character of value) {
      detector.push(character, at);
      at += gapMs;
    }
    return detector.push("Enter", at);
  }

  it("reads a scanner gun: thirteen digits, no gap over 30ms, then Enter", () => {
    const result = type(createHidDetector(), EAN_13, 8);
    expect(result).toMatchObject({ type: "scan", value: EAN_13, maxGapMs: 8 });
  });

  it("refuses the same digits typed by a person", () => {
    const result = type(createHidDetector(), EAN_13, 120);
    expect(result).toMatchObject({ type: "rejected", reason: "too-slow" });
  });

  it("draws the line where the option says", () => {
    expect(type(createHidDetector(), EAN_13, HID_MAX_GAP_MS).type).toBe("scan");
    expect(type(createHidDetector(), EAN_13, HID_MAX_GAP_MS + 1).type).toBe("rejected");
  });

  it("condemns a burst on its slowest gap, not its average", () => {
    const detector = createHidDetector();
    detector.push("5", 1_000);
    detector.push("0", 1_005);
    // One stall in the middle. A gun does not stall; a person resting does.
    detector.push("1", 1_200);
    for (const [index, character] of [..."2345678900"].entries()) {
      detector.push(character, 1_205 + index * 5);
    }
    expect(detector.push("Enter", 1_260)).toMatchObject({
      type: "rejected",
      reason: "too-slow",
      maxGapMs: 195,
    });
  });

  it("does not blame a scan for the pause before it started", () => {
    const detector = createHidDetector();
    // Someone pressed a key, wandered off, then fired the gun.
    detector.push("x", 1_000);
    let at = 9_000;
    for (const character of EAN_13) {
      detector.push(character, at);
      at += 6;
    }
    expect(detector.push("Enter", at)).toMatchObject({ type: "scan", value: EAN_13 });
  });

  it("refuses something too short to be a barcode", () => {
    expect(type(createHidDetector(), "12", 5)).toMatchObject({
      type: "rejected",
      reason: "too-short",
    });
  });

  it("refuses a bare Enter", () => {
    expect(createHidDetector().push("Enter", 1_000)).toMatchObject({
      type: "rejected",
      reason: "empty",
    });
  });

  it("ignores modifiers rather than treating them as characters", () => {
    const detector = createHidDetector();
    let at = 1_000;
    for (const character of EAN_13) {
      detector.push("Shift", at);
      detector.push(character, at);
      at += 6;
    }
    expect(detector.push("Enter", at)).toMatchObject({ type: "scan", value: EAN_13 });
  });

  it("abandons the buffer when a control key arrives", () => {
    const detector = createHidDetector();
    detector.push("5", 1_000);
    detector.push("0", 1_005);
    detector.push("Tab", 1_010);
    expect(detector.buffered()).toBe("");
  });

  it("carries the letters a Code 128 carton label sends", () => {
    const result = type(createHidDetector(), "CARTON-8842", 7);
    expect(result).toMatchObject({ type: "scan", value: "CARTON-8842" });
  });

  it("reports the slowest gap so a gun can be tuned from the debug panel", () => {
    const result = type(createHidDetector(), EAN_13, 11);
    expect(result).toMatchObject({ maxGapMs: 11 });
  });
});

describe("resolveEngine", () => {
  const native = [...REQUIRED_NATIVE_FORMATS, "ean_8"];

  it("uses the native detector when the browser has a usable one", () => {
    expect(
      resolveEngine({ requested: "auto", hasNativeDetector: true, nativeFormats: native }).engine,
    ).toBe("native");
  });

  it("falls back to ZXing when the browser has none", () => {
    const choice = resolveEngine({ requested: "auto", hasNativeDetector: false });
    expect(choice.engine).toBe("zxing");
    expect(choice.reason).toContain("no BarcodeDetector");
  });

  it("falls back when the detector exists but reads none of our formats", () => {
    // Chrome on desktop Linux: the API is there and getSupportedFormats() is empty.
    const choice = resolveEngine({
      requested: "auto",
      hasNativeDetector: true,
      nativeFormats: [],
      requiredFormats: REQUIRED_NATIVE_FORMATS,
    });
    expect(choice.engine).toBe("zxing");
    expect(choice.reason).toContain("reads none of");
  });

  it("forces ZXing on request, however capable the browser is", () => {
    // The whole reason this exists: Android Chrome has BarcodeDetector, so the
    // fallback never runs here by itself.
    const choice = resolveEngine({
      requested: "zxing",
      hasNativeDetector: true,
      nativeFormats: native,
      requiredFormats: REQUIRED_NATIVE_FORMATS,
    });
    expect(choice.engine).toBe("zxing");
    expect(choice.reason).toContain("forced");
  });

  it("says so when native was asked for and is not there", () => {
    const choice = resolveEngine({ requested: "native", hasNativeDetector: false });
    expect(choice.engine).toBe("zxing");
    expect(choice.reason).toContain("this browser has none");
  });
});

describe("parseEngineRequest", () => {
  it("takes only the two spellings that mean something", () => {
    expect(parseEngineRequest("zxing")).toBe("zxing");
    expect(parseEngineRequest("native")).toBe("native");
    expect(parseEngineRequest("ZXING")).toBe("auto");
    expect(parseEngineRequest("wasm")).toBe("auto");
    expect(parseEngineRequest(null)).toBe("auto");
    expect(parseEngineRequest(undefined)).toBe("auto");
  });
});
