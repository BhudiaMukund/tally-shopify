/// <reference lib="webworker" />
import { computeTargetSize, WEBP_QUALITY } from "./downscale-math";
import type { DownscaleRequest, DownscaleResponse } from "./downscale-protocol";

/**
 * The actual resize and re-encode, off the main thread — a 12MP photo drawn
 * and compressed on the UI thread would stall the price/quantity form the
 * user is meant to be filling in at the same time (BUILD_PLAN §9: uploads run
 * "in parallel with the user entering price and quantity").
 */

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (event: MessageEvent<DownscaleRequest>) => {
  const { id, bitmap } = event.data;
  const startedAt = performance.now();

  void (async () => {
    try {
      const target = computeTargetSize({ width: bitmap.width, height: bitmap.height });
      const canvas = new OffscreenCanvas(target.width, target.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("2d context unavailable in worker");

      context.drawImage(bitmap, 0, 0, target.width, target.height);
      bitmap.close();

      const blob = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
      const response: DownscaleResponse = {
        type: "result",
        id,
        blob,
        width: target.width,
        height: target.height,
        ms: Math.round(performance.now() - startedAt),
      };
      self.postMessage(response);
    } catch (error) {
      const response: DownscaleResponse = {
        type: "error",
        id,
        message: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  })();
});

self.postMessage({ type: "ready" } satisfies DownscaleResponse);
