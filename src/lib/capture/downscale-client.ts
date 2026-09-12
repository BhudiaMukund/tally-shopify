import type { DownscaleRequest, DownscaleResponse } from "./downscale-protocol";

/**
 * The page's end of the downscale worker — mirrors `src/lib/scan/zxing-client.ts`.
 */

export interface DownscaleResult {
  blob: Blob;
  width: number;
  height: number;
  ms: number;
}

export interface DownscaleClient {
  ready: Promise<void>;
  downscale: (bitmap: ImageBitmap) => Promise<DownscaleResult>;
  terminate: () => void;
}

export function createDownscaleClient(): DownscaleClient {
  const worker = new Worker(new URL("./downscale.worker.ts", import.meta.url), {
    type: "module",
    name: "tally-downscale",
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (result: DownscaleResult) => void; reject: (error: Error) => void }
  >();

  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  worker.addEventListener("message", (event: MessageEvent<DownscaleResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      resolveReady();
      return;
    }

    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (entry === undefined) return;

    if (message.type === "result") {
      entry.resolve({
        blob: message.blob,
        width: message.width,
        height: message.height,
        ms: message.ms,
      });
    } else {
      entry.reject(new Error(message.message));
    }
  });

  return {
    ready,

    downscale(bitmap: ImageBitmap): Promise<DownscaleResult> {
      const id = nextId;
      nextId += 1;

      return new Promise<DownscaleResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: DownscaleRequest = { id, bitmap };
        worker.postMessage(request, [request.bitmap]);
      });
    },

    terminate(): void {
      for (const { reject } of pending.values()) reject(new Error("downscale worker terminated"));
      pending.clear();
      worker.terminate();
    },
  };
}
