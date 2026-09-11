/** Bounds and increment for a count field. Kept pure so it can be unit tested. */
export interface CountBounds {
  min: number;
  max: number;
  step: number;
}

/** A stocktake count: never negative, never larger than any real shelf. */
export const DEFAULT_BOUNDS: CountBounds = { min: 0, max: 99_999, step: 1 };

export function clampCount(value: number, bounds: CountBounds): number {
  if (!Number.isFinite(value)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

/** One press of − or +. Direction is -1 or 1. */
export function stepCount(value: number, direction: -1 | 1, bounds: CountBounds): number {
  return clampCount(value + direction * bounds.step, bounds);
}

/**
 * What the user typed. Digits only — a thumb on a phone keypad produces stray
 * spaces and the odd comma, and none of them mean anything in a count.
 * Returns null for "the field is empty", which is not the same as zero.
 */
export function parseCount(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;
  return Number.parseInt(digits, 10);
}

/**
 * Press-and-hold repeat delay, in ms, for the nth repeat. Slow enough that a
 * deliberate single press never double-fires, then accelerating so counting a
 * carton of 60 does not take 60 taps.
 */
export function repeatDelay(repeatIndex: number): number {
  if (repeatIndex === 0) return 400;
  if (repeatIndex < 6) return 140;
  if (repeatIndex < 16) return 80;
  return 45;
}
