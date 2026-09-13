import { describe, expect, it } from "vitest";

import { findOrphanedKeys } from "./sweep-orphans";

/**
 * The whole safety property of the sweep in one function: a key is only ever
 * deleted when it is *both* unreferenced *and* old enough that a draft mid-
 * edit couldn't still be about to reference it (BUILD_PLAN §11).
 */

const NOW = new Date("2026-06-15T00:00:00Z");
const EIGHT_DAYS_AGO = new Date("2026-06-07T00:00:00Z");
const ONE_DAY_AGO = new Date("2026-06-14T00:00:00Z");

describe("findOrphanedKeys", () => {
  it("keeps a referenced object regardless of age", () => {
    const orphans = findOrphanedKeys(
      [{ key: "intake/a.webp", lastModified: EIGHT_DAYS_AGO }],
      new Set(["intake/a.webp"]),
      NOW,
    );
    expect(orphans).toEqual([]);
  });

  it("keeps an unreferenced object younger than 7 days", () => {
    const orphans = findOrphanedKeys(
      [{ key: "intake/b.webp", lastModified: ONE_DAY_AGO }],
      new Set(),
      NOW,
    );
    expect(orphans).toEqual([]);
  });

  it("deletes only what is both unreferenced and old", () => {
    const orphans = findOrphanedKeys(
      [
        { key: "intake/kept-referenced.webp", lastModified: EIGHT_DAYS_AGO },
        { key: "intake/kept-recent.webp", lastModified: ONE_DAY_AGO },
        { key: "intake/orphan.webp", lastModified: EIGHT_DAYS_AGO },
      ],
      new Set(["intake/kept-referenced.webp"]),
      NOW,
    );
    expect(orphans).toEqual(["intake/orphan.webp"]);
  });
});
