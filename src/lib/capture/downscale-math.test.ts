import { describe, expect, it } from "vitest";

import { computeTargetSize } from "./downscale-math";

describe("computeTargetSize", () => {
  it("leaves an already-small image alone", () => {
    expect(computeTargetSize({ width: 800, height: 600 }, 2000)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("scales a landscape photo down to the max on its long edge", () => {
    // A typical 4:3 phone photo, long edge well over the limit.
    expect(computeTargetSize({ width: 4032, height: 3024 }, 2000)).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it("scales a portrait photo down on its long edge, not its short one", () => {
    expect(computeTargetSize({ width: 3024, height: 4032 }, 2000)).toEqual({
      width: 1500,
      height: 2000,
    });
  });

  it("never scales up", () => {
    expect(computeTargetSize({ width: 100, height: 50 }, 2000)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("treats exactly-at-the-limit as already small enough", () => {
    expect(computeTargetSize({ width: 2000, height: 1000 }, 2000)).toEqual({
      width: 2000,
      height: 1000,
    });
  });

  it("never rounds a dimension down to zero for an extreme aspect ratio", () => {
    const result = computeTargetSize({ width: 10000, height: 1 }, 2000);
    expect(result.width).toBe(2000);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
