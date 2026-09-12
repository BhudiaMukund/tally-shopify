/**
 * The messages the downscale worker and the page exchange. Its own module for
 * the same reason as `src/lib/scan/zxing-protocol.ts`: the client can import
 * this without pulling the worker's own code into the page bundle.
 */

export interface DownscaleRequest {
  id: number;
  /** Transferred, not copied — decoding already happened on the main thread via `createImageBitmap`. */
  bitmap: ImageBitmap;
}

export type DownscaleResponse =
  | { type: "ready" }
  | { type: "result"; id: number; blob: Blob; width: number; height: number; ms: number }
  | { type: "error"; id: number; message: string };
