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
 * A run of digits, optionally grouped by a space or comma — a thumb on a phone
 * keypad produces stray separators and neither means anything in a count.
 */
const COUNT_PATTERN = /^\d+(?:[ ,]\d+)*$/;

/**
 * What the user typed, or null when it is not a count at all. Null covers both
 * "the field is empty" and "that is not a number", which are different from
 * zero and from each other but lead to the same place: leave the count alone.
 *
 * Anything outside the pattern is rejected rather than salvaged. Stripping the
 * non-digits instead — which is what this used to do — quietly turns "-5" into
 * 5, "1.5" into 15 and "1e3" into 13, so a mistyped entry becomes a plausible
 * and much larger stock figure that nobody would question on the shelf. A
 * rejected entry reverts the field to the committed count, which is visible.
 *
 * Rejecting is also why a negative is not clamped to `min`: clamping "-5" would
 * silently set the count to zero, and writing a zero nobody typed is worse than
 * doing nothing.
 */
export function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!COUNT_PATTERN.test(trimmed)) return null;
  return Number.parseInt(trimmed.replace(/[ ,]/g, ""), 10);
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

/**
 * Where a press of − or + should count from.
 *
 * A count typed on the keypad and then nudged with a stepper has to continue
 * from the number on screen, not from the last value committed — otherwise
 * typing 50 and pressing + gives 25, and the correction is silently lost.
 * An unparseable or empty draft falls back to the committed value.
 */
export function resolveStepBase(
  draft: string | null,
  committed: number,
  bounds: CountBounds,
): number {
  if (draft === null) return committed;
  const typed = parseCount(draft);
  return typed === null ? committed : clampCount(typed, bounds);
}
