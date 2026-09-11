import { describe, expect, it } from "vitest";

import {
  clampCount,
  DEFAULT_BOUNDS,
  parseCount,
  repeatDelay,
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
  it("reads digits and ignores everything else", () => {
    expect(parseCount("24")).toBe(24);
    expect(parseCount(" 1 200 ")).toBe(1200);
    expect(parseCount("1,024")).toBe(1024);
    expect(parseCount("-5")).toBe(5);
  });

  it("distinguishes an empty field from zero", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount("  ")).toBeNull();
    expect(parseCount("abc")).toBeNull();
    expect(parseCount("0")).toBe(0);
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
