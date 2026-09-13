// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CapturedPhoto } from "@/lib/capture/use-photo-capture";

/**
 * The one branch that matters here: online with every photo landed posts
 * immediately, and anything else — offline, a mid-flight network failure, a
 * photo that hasn't uploaded yet — queues instead of throwing. A genuine
 * server rejection is the one thing that must NOT be swallowed into a queue.
 */

const saveQueuedDraft = vi.fn();
vi.mock("./offline-queue", () => ({
  saveQueuedDraft: (...args: unknown[]) => saveQueuedDraft(...args),
}));

const { submitDraft, IntakeRequestError } = await import("./submit-draft");

function uploadedPhoto(id = "p1"): CapturedPhoto {
  return {
    id,
    previewUrl: "blob:preview",
    status: "uploaded",
    width: 800,
    height: 800,
    bytes: 5000,
    key: `intake/${id}.webp`,
    publicUrl: `https://files.example.com/intake/${id}.webp`,
    error: null,
  };
}

function offlinePhoto(id = "p1"): CapturedPhoto {
  return {
    id,
    previewUrl: "blob:preview",
    status: "queued-offline",
    width: 800,
    height: 800,
    bytes: 5000,
    key: null,
    publicUrl: null,
    error: "Not uploaded yet — check the connection and retry.",
  };
}

function input(photos: CapturedPhoto[]) {
  return {
    scanId: "3f1a9c4e-0b22-4f4a-9d6b-1c5e2a7d8f90",
    kind: "new_product" as const,
    barcodeRaw: "9310720073156",
    price: "12.50",
    qty: 4,
    deviceId: "pixel-7a",
    photos,
  };
}

beforeEach(() => {
  saveQueuedDraft.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("submitDraft", () => {
  it("posts immediately when online and every photo has uploaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ draftId: "d1" }) }),
    );

    const result = await submitDraft(input([uploadedPhoto()]));

    expect(result).toEqual({ outcome: "submitted", draftId: "d1" });
    expect(saveQueuedDraft).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("queues instead of throwing when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    vi.stubGlobal("fetch", vi.fn());

    const result = await submitDraft(input([uploadedPhoto()]));

    expect(result).toEqual({ outcome: "queued" });
    expect(saveQueuedDraft).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("queues when a photo hasn't uploaded yet, even while online", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const result = await submitDraft(input([offlinePhoto()]));

    expect(result).toEqual({ outcome: "queued" });
    expect(saveQueuedDraft).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("queues on a mid-flight network failure rather than surfacing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = await submitDraft(input([uploadedPhoto()]));

    expect(result).toEqual({ outcome: "queued" });
    expect(saveQueuedDraft).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("re-throws a genuine server rejection instead of queueing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ message: "Bad price" }),
        }),
    );

    await expect(submitDraft(input([uploadedPhoto()]))).rejects.toThrow(IntakeRequestError);
    expect(saveQueuedDraft).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
