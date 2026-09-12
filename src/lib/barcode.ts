/**
 * Barcode normalisation.
 *
 * Every read and every write goes through here (CLAUDE.md §3). Three things
 * make that necessary:
 *
 * 1. Spreadsheet round-tripping leaves stray apostrophes and quotes on codes —
 *    Excel's way of saying "this is text, don't eat the leading zero".
 * 2. The same trade item is legitimately printed as a UPC-A in one place and an
 *    EAN-13 in another. They are the same number with different left padding,
 *    so comparison happens on the 14-digit form and nothing else.
 * 3. Some of what is in the catalogue today is not a GTIN at all. That is not a
 *    reason to crash; it is what `scripts/audit-barcodes.ts` exists to list.
 */

/** The four legal GTIN lengths. Anything else is not a barcode we can trust. */
export const GTIN_LENGTHS = [8, 12, 13, 14] as const;

/** What every barcode is compared at: GTIN-14, left-padded with zeros. */
export const BARCODE_KEY_LENGTH = 14;

/**
 * Strips a raw value to digits.
 *
 * Deliberately blunt: apostrophes, quotes, spaces, hyphens and any other
 * punctuation a scanner or a spreadsheet may have introduced all go. A value
 * that was never a number in the first place comes back empty rather than
 * half-parsed.
 */
export function toDigits(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\D+/g, "");
}

/** The GTIN check digit for a body that does not include one. */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,1… counting from the right of the body, which is
  // the position the check digit will occupy minus one.
  for (let index = 0; index < body.length; index += 1) {
    const digit = body.charCodeAt(body.length - 1 - index) - 48;
    sum += index % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the last digit of a full GTIN is the one the rest of it implies. */
export function hasValidCheckDigit(digits: string): boolean {
  if (digits.length < 2) return false;
  const body = digits.slice(0, -1);
  const check = digits.charCodeAt(digits.length - 1) - 48;
  return gtinCheckDigit(body) === check;
}

function isGtinLength(length: number): boolean {
  return (GTIN_LENGTHS as readonly number[]).includes(length);
}

/**
 * The comparison key: the digits left-padded to 14.
 *
 * `036000291452` (UPC-A) and `0036000291452` (its EAN-13 form) are the same
 * item and produce the same key. A 14-digit code with a non-zero indicator
 * digit is a *different* trade item — a case of twelve rather than a single —
 * and correctly produces a different key.
 */
export function barcodeKey(digits: string): string {
  return digits.padStart(BARCODE_KEY_LENGTH, "0");
}

export type BarcodeProblem =
  /** Nothing but punctuation, or empty. */
  | "empty"
  /** Digits, but not 8, 12, 13 or 14 of them. */
  | "length"
  /** Right length, wrong check digit. */
  | "check-digit";

export interface NormalisedBarcode {
  /** What was scanned or stored, untouched. Kept for the audit report. */
  raw: string;
  /** Digits only. This is what gets written to Mongo. */
  digits: string;
  /** The 14-digit comparison form. Empty when there are no digits. */
  key: string;
  /** One of the four GTIN lengths. */
  wellFormed: boolean;
  /** The check digit agrees with the rest. Only meaningful when `wellFormed`. */
  checkDigitOk: boolean;
  /** A barcode with nothing wrong with it: right length, right check digit. */
  ok: boolean;
  problem?: BarcodeProblem;
}

export function normaliseBarcode(raw: string | null | undefined): NormalisedBarcode {
  const digits = toDigits(raw);
  const base = { raw: raw ?? "", digits, key: digits === "" ? "" : barcodeKey(digits) };

  if (digits === "") {
    return { ...base, wellFormed: false, checkDigitOk: false, ok: false, problem: "empty" };
  }
  if (!isGtinLength(digits.length)) {
    return { ...base, wellFormed: false, checkDigitOk: false, ok: false, problem: "length" };
  }

  const checkDigitOk = hasValidCheckDigit(digits);
  return {
    ...base,
    wellFormed: true,
    checkDigitOk,
    ok: checkDigitOk,
    ...(checkDigitOk ? {} : { problem: "check-digit" as const }),
  };
}

/** Two codes are the same item when their 14-digit forms match. */
export function sameBarcode(a: string, b: string): boolean {
  const left = toDigits(a);
  const right = toDigits(b);
  if (left === "" || right === "") return false;
  return barcodeKey(left) === barcodeKey(right);
}

/**
 * Every spelling of one code that could be stored against a variant.
 *
 * Shopify holds whatever was typed in — a UPC-A here, the same item's EAN-13
 * there — so a lookup that matched on the scanned string alone would miss its
 * own catalogue. Mongo gets these as an `$in` against the indexed `barcode`
 * field, and Shopify's search gets them as an `OR`, which is why this returns
 * concrete strings rather than asking either side to do the padding.
 *
 * Ordered shortest-first and always including the input itself.
 */
export function barcodeCandidates(raw: string): string[] {
  const digits = toDigits(raw);
  if (digits === "") return [];

  const key = barcodeKey(digits);
  const candidates = new Set<string>([digits]);

  for (const length of GTIN_LENGTHS) {
    if (length > BARCODE_KEY_LENGTH) continue;
    const trimmed = key.slice(BARCODE_KEY_LENGTH - length);
    // Only a form that keeps every significant digit — trimming a non-zero
    // would silently turn the code into a different item.
    if (trimmed.padStart(BARCODE_KEY_LENGTH, "0") === key) candidates.add(trimmed);
  }

  return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b));
}
