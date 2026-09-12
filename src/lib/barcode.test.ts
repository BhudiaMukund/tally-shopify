import { describe, expect, it } from "vitest";

import {
  barcodeCandidates,
  barcodeKey,
  gtinCheckDigit,
  hasValidCheckDigit,
  normaliseBarcode,
  sameBarcode,
  toDigits,
} from "./barcode";

/**
 * Fixtures are synthetic GTINs with real check digits (CLAUDE.md, "this repo is
 * public"). Nothing here is a catalogue value.
 *
 *   EAN_13   5012345678900   check digit computed below, so the maths is checked too
 *   UPC_A    036000291452    the GS1 example code
 *   EAN_8    96385074
 *   GTIN_14  15012345678907  EAN_13's item, indicator 1 — a *case*, not the same thing
 */
const EAN_13 = "5012345678900";
const UPC_A = "036000291452";
const UPC_A_AS_EAN_13 = "0036000291452";
const EAN_8 = "96385074";
const GTIN_14 = "15012345678907";

describe("toDigits", () => {
  it("keeps digits and drops everything else", () => {
    expect(toDigits(`'${EAN_13}`)).toBe(EAN_13);
    expect(toDigits(`"${EAN_13}"`)).toBe(EAN_13);
    expect(toDigits(" 501 2345-678900 ")).toBe(EAN_13);
    expect(toDigits("\u201c5012345678900\u201d")).toBe(EAN_13);
  });

  it("returns empty for a value that holds no digits at all", () => {
    expect(toDigits("n/a")).toBe("");
    expect(toDigits("")).toBe("");
    expect(toDigits(null)).toBe("");
    expect(toDigits(undefined)).toBe("");
  });
});

describe("gtinCheckDigit", () => {
  it("computes the digit that makes each fixture valid", () => {
    for (const code of [EAN_13, UPC_A, EAN_8, GTIN_14]) {
      expect(gtinCheckDigit(code.slice(0, -1))).toBe(Number(code.slice(-1)));
    }
  });

  it("rejects a transposition", () => {
    // 5012345678900 with two digits swapped is still 13 digits and still scans.
    expect(hasValidCheckDigit("5012345687900")).toBe(false);
  });
});

describe("normaliseBarcode", () => {
  it("accepts a clean EAN-13", () => {
    const result = normaliseBarcode(EAN_13);
    expect(result).toMatchObject({
      digits: EAN_13,
      key: "0" + EAN_13,
      wellFormed: true,
      checkDigitOk: true,
      ok: true,
    });
    expect(result.problem).toBeUndefined();
  });

  it("strips a leading apostrophe left by a spreadsheet", () => {
    const result = normaliseBarcode(`'${EAN_13}`);
    expect(result.digits).toBe(EAN_13);
    expect(result.ok).toBe(true);
    // The raw value survives for the audit report.
    expect(result.raw).toBe(`'${EAN_13}`);
  });

  it("accepts all four GTIN lengths", () => {
    for (const code of [EAN_8, UPC_A, EAN_13, GTIN_14]) {
      expect(normaliseBarcode(code).ok).toBe(true);
    }
  });

  it("rejects a 6-digit string", () => {
    const result = normaliseBarcode("123456");
    expect(result.wellFormed).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe("length");
  });

  it("rejects 9 and 11 digits, which the catalogue still contains", () => {
    expect(normaliseBarcode("123456789").problem).toBe("length");
    expect(normaliseBarcode("12345678901").problem).toBe("length");
  });

  it("reports an empty value separately from a malformed one", () => {
    expect(normaliseBarcode("").problem).toBe("empty");
    expect(normaliseBarcode("   ").problem).toBe("empty");
    expect(normaliseBarcode(undefined).problem).toBe("empty");
  });

  it("separates a bad check digit from a bad length", () => {
    // Right length, wrong last digit. Well-formed enough to look up — the
    // catalogue holds hand-typed codes and refusing the scan would only make
    // staff capture a duplicate product.
    const result = normaliseBarcode("5012345678901");
    expect(result.wellFormed).toBe(true);
    expect(result.checkDigitOk).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe("check-digit");
  });
});

describe("barcodeKey", () => {
  it("left-pads to 14", () => {
    expect(barcodeKey(EAN_8)).toBe("00000096385074");
    expect(barcodeKey(GTIN_14)).toBe(GTIN_14);
  });
});

describe("sameBarcode", () => {
  it("matches a UPC-A against its EAN-13 form", () => {
    expect(sameBarcode(UPC_A, UPC_A_AS_EAN_13)).toBe(true);
    expect(sameBarcode(`'${UPC_A}`, UPC_A_AS_EAN_13)).toBe(true);
  });

  it("does not match a GTIN-14 case code to the item it contains", () => {
    expect(sameBarcode(GTIN_14, EAN_13)).toBe(false);
  });

  it("never matches on an empty value", () => {
    expect(sameBarcode("", "")).toBe(false);
    expect(sameBarcode("n/a", EAN_13)).toBe(false);
  });
});

describe("barcodeCandidates", () => {
  it("offers every zero-padded spelling of the same item", () => {
    expect(barcodeCandidates(UPC_A)).toEqual([UPC_A, UPC_A_AS_EAN_13, "00" + UPC_A]);
  });

  it("is symmetric — the EAN-13 form finds the UPC-A", () => {
    expect(barcodeCandidates(UPC_A_AS_EAN_13)).toContain(UPC_A);
  });

  it("does not truncate a significant digit", () => {
    // 5012345678900 cannot be spelled as a 12-digit code without losing the 5.
    expect(barcodeCandidates(EAN_13)).toEqual([EAN_13, "0" + EAN_13]);
  });

  it("still answers for a code we would not call well-formed", () => {
    // Lookup is more forgiving than validation: an 11-digit code in the
    // catalogue is junk, but it is junk someone can still scan.
    expect(barcodeCandidates("12345678901")).toEqual([
      "12345678901",
      "012345678901",
      "0012345678901",
      "00012345678901",
    ]);
  });

  it("returns nothing for a value with no digits", () => {
    expect(barcodeCandidates("n/a")).toEqual([]);
  });
});
