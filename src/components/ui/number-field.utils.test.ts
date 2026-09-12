import { describe, expect, it } from "vitest";

import {
  clampCount,
  DEFAULT_BOUNDS,
  parseCount,
  repeatDelay,
  resolveStepBase,
  stepCount,
} from "./number-field.utils";

describe("clampCount", () => {
  it("holds the value inside the bounds", () => {
    expect(clampCount(-4, DEFAULT_BOUNDS)).toBe(0);
    expect(clampCount(12, DEFAULT_BOUNDS)).toBe(12);
    expect(clampCount(1_000_000, DEFAULT_BOUNDS)).toBe(99_999);
  });

  it("truncates toward zero and rejects non-finite input", () => {
    expect(clampCount(7.9, DEFAULT_BOUNDS)).toBe(7);
    expect(clampCount(Number.NaN, DEFAULT_BOUNDS)).toBe(0);
  });
});

describe("stepCount", () => {
  it("steps by the configured amount", () => {
    expect(stepCount(10, 1, DEFAULT_BOUNDS)).toBe(11);
    expect(stepCount(10, -1, DEFAULT_BOUNDS)).toBe(9);
    expect(stepCount(10, 1, { min: 0, max: 100, step: 12 })).toBe(22);
  });

  it("stops at the bounds rather than wrapping", () => {
    expect(stepCount(0, -1, DEFAULT_BOUNDS)).toBe(0);
    expect(stepCount(99_999, 1, DEFAULT_BOUNDS)).toBe(99_999);
    expect(stepCount(95, 1, { min: 0, max: 100, step: 12 })).toBe(100);
  });
});

describe("parseCount", () => {
  it("reads a count, allowing the separators a thumb produces", () => {
    expect(parseCount("24")).toBe(24);
    expect(parseCount(" 1 200 ")).toBe(1200);
    expect(parseCount("1,024")).toBe(1024);
  });

  it("distinguishes an empty field from zero", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount("  ")).toBeNull();
    expect(parseCount("0")).toBe(0);
  });

  it("rejects input rather than salvaging digits out of it", () => {
    // Each of these used to come back as a plausible, larger stock figure.
    expect(parseCount("-5")).toBeNull(); // was 5
    expect(parseCount("1.5")).toBeNull(); // was 15
    expect(parseCount("1e3")).toBeNull(); // was 13
    expect(parseCount("12abc")).toBeNull(); // was 12
    expect(parseCount("abc")).toBeNull();
    expect(parseCount("+7")).toBeNull();
    expect(parseCount("2/4")).toBeNull();
  });

  it("never returns a negative count", () => {
    for (const raw of ["-5", "-0", "- 5", "−5"]) {
      const parsed = parseCount(raw);
      expect(parsed === null || parsed >= 0).toBe(true);
    }
  });
});

describe("resolveStepBase", () => {
  const bounds = DEFAULT_BOUNDS;

  it("counts from the typed number, not the committed one", () => {
    // Typing 50 over a committed 24 and pressing + must give 51, not 25.
    expect(resolveStepBase("50", 24, bounds)).toBe(50);
    expect(stepCount(resolveStepBase("50", 24, bounds), 1, bounds)).toBe(51);
    expect(stepCount(resolveStepBase("50", 24, bounds), -1, bounds)).toBe(49);
  });

  it("falls back to the committed value once the draft is cleared", () => {
    // This is what every repeat of a press-and-hold sees after the first step.
    expect(resolveStepBase(null, 24, bounds)).toBe(24);
  });

  it("falls back to the committed value for input that is not a count", () => {
    for (const raw of ["", "  ", "abc", "-5", "1.5", "12abc"]) {
      expect(resolveStepBase(raw, 24, bounds)).toBe(24);
    }
  });

  it("clamps a typed value into bounds before stepping", () => {
    const small = { min: 0, max: 20, step: 1 };
    expect(resolveStepBase("999", 5, small)).toBe(20);
    expect(stepCount(resolveStepBase("999", 5, small), 1, small)).toBe(20);
    expect(resolveStepBase("1,024", 5, small)).toBe(20);
  });

  it("treats a typed zero as a real value, not as an empty field", () => {
    expect(resolveStepBase("0", 24, bounds)).toBe(0);
    expect(stepCount(resolveStepBase("0", 24, bounds), 1, bounds)).toBe(1);
  });
});

describe("repeatDelay", () => {
  it("never speeds up between repeats", () => {
    const delays = Array.from({ length: 30 }, (_, i) => repeatDelay(i));
    expect(delays[0]).toBe(400);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!).toBeLessThanOrEqual(delays[i - 1]!);
    }
  });
});
