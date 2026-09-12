/**
 * Telling a scanner gun from a person, by how fast the keys arrive.
 *
 * A keyboard-wedge scanner is a keyboard as far as the browser is concerned: it
 * types the barcode and presses Enter. Nothing identifies it. The one thing it
 * cannot hide is speed — a gun emits a character every few milliseconds, and
 * nobody types thirteen digits with no gap longer than 30ms.
 *
 * This is the future path: the shop uses phone cameras today, and swapping in a
 * USB gun should be plugging it in, not a rewrite. Keeping the rule here, as a
 * state machine over `{ key, at }`, is what makes it testable without a gun.
 */

/** Above this, a gap between two characters is a person. */
export const HID_MAX_GAP_MS = 30;

/** Shorter than this is a keypress, not a barcode. EAN-8 is the shortest real code. */
export const HID_MIN_LENGTH = 6;

/** A quiet spell this long starts a new buffer rather than extending the old one. */
export const HID_RESET_MS = 500;

export interface HidOptions {
  maxGapMs?: number;
  minLength?: number;
  resetAfterMs?: number;
}

export type HidRejection =
  /** Enter arrived with nothing buffered. */
  | "empty"
  /** Fewer characters than any barcode has. */
  | "too-short"
  /** At least one gap was slow enough to be a person typing. */
  | "too-slow";

export type HidResult =
  | { type: "none" }
  | { type: "scan"; value: string; maxGapMs: number; durationMs: number }
  | { type: "rejected"; reason: HidRejection; value: string; maxGapMs: number };

export interface HidDetector {
  /** Feed one keydown. Returns a scan only on the Enter that completes one. */
  push: (key: string, at: number) => HidResult;
  reset: () => void;
  /** What is buffered right now. For the debug panel. */
  buffered: () => string;
}

/** Modifiers arrive as their own keydown and mean nothing on their own. */
const IGNORED_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "Dead"]);

/**
 * Barcode characters. Deliberately not just digits: Code 128 carries letters
 * and punctuation, and a gun configured for a carton label will send them.
 */
function isPrintable(key: string): boolean {
  return key.length === 1 && key !== " ";
}

export function createHidDetector({
  maxGapMs = HID_MAX_GAP_MS,
  minLength = HID_MIN_LENGTH,
  resetAfterMs = HID_RESET_MS,
}: HidOptions = {}): HidDetector {
  let characters: string[] = [];
  let maxGap = 0;
  let startedAt = 0;
  let lastAt = 0;

  function reset(): void {
    characters = [];
    maxGap = 0;
    startedAt = 0;
    lastAt = 0;
  }

  return {
    push(key: string, at: number): HidResult {
      if (IGNORED_KEYS.has(key)) return { type: "none" };

      if (key === "Enter" || key === "NumpadEnter") {
        const value = characters.join("");
        const gap = maxGap;
        const duration = lastAt - startedAt;
        reset();

        if (value === "") return { type: "rejected", reason: "empty", value, maxGapMs: gap };
        if (value.length < minLength) {
          return { type: "rejected", reason: "too-short", value, maxGapMs: gap };
        }
        // The whole test. A person cannot hold every gap under 30ms; a gun
        // cannot help it.
        if (gap > maxGapMs) {
          return { type: "rejected", reason: "too-slow", value, maxGapMs: gap };
        }
        return { type: "scan", value, maxGapMs: gap, durationMs: duration };
      }

      if (!isPrintable(key)) {
        // Tab, Escape, an arrow key: whatever was buffered was not a scan.
        reset();
        return { type: "none" };
      }

      const sinceLast = characters.length === 0 ? 0 : at - lastAt;

      // A long pause is a new burst, not a slow one. The gap between an
      // unrelated keypress and the start of a scan must not condemn the scan.
      if (characters.length > 0 && sinceLast > resetAfterMs) {
        characters = [];
        maxGap = 0;
        startedAt = at;
      } else if (characters.length === 0) {
        startedAt = at;
      } else {
        maxGap = Math.max(maxGap, sinceLast);
      }

      characters.push(key);
      lastAt = at;
      return { type: "none" };
    },

    reset,

    buffered(): string {
      return characters.join("");
    },
  };
}
