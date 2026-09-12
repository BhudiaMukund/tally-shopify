import type { DecodeRequest, DecodeResponse } from "./zxing-protocol";

/**
 * The page's end of the ZXing worker.
 *
 * One decode in flight at a time — queueing frames behind a slow decoder only
 * produces answers about where the barcode used to be. The pump asks
 * `isBusy()` and skips the frame instead.
 */

export interface DecodeOutcome {
  text: string | null;
  format: string | null;
  /** Time inside the worker, not including the transfer. */
  ms: number;
}

export interface ZxingClient {
  ready: Promise<void>;
  decode: (image: ImageData) => Promise<DecodeOutcome>;
  isBusy: () => boolean;
  terminate: () => void;
}

export function createZxingClient(): ZxingClient {
  /**
   * `new URL(…, import.meta.url)` is the form bundlers recognise: it is what
   * makes the worker a separate chunk rather than something to be inlined. A
   * variable in here and nothing gets built.
   */
  const worker = new Worker(new URL("./zxing.worker.ts", import.meta.url), {
    type: "module",
    name: "tally-zxing",
  });

  let nextId = 1;
  let busy = false;
  const pending = new Map<number, (outcome: DecodeOutcome) => void>();

  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  worker.addEventListener("message", (event: MessageEvent<DecodeResponse>) => {
    const message = event.data;
    if (message.type === "ready") {
      resolveReady();
      return;
    }

    const settle = pending.get(message.id);
    pending.delete(message.id);
    busy = pending.size > 0;
    if (settle === undefined) return;

    if (message.type === "result") {
      settle({ text: message.text, format: message.format, ms: message.ms });
    } else if (message.type === "empty") {
      settle({ text: null, format: null, ms: message.ms });
    } else {
      settle({ text: null, format: null, ms: 0 });
    }
  });

  return {
    ready,

    decode(image: ImageData): Promise<DecodeOutcome> {
      const id = nextId;
      nextId += 1;
      busy = true;

      return new Promise<DecodeOutcome>((resolve) => {
        pending.set(id, resolve);

        const request: DecodeRequest = {
          id,
          // A fresh ImageData every frame, so handing the buffer over rather
          // than copying half a megabyte costs nothing and saves the copy.
          buffer: image.data.buffer as ArrayBuffer,
          width: image.width,
          height: image.height,
        };
        worker.postMessage(request, [request.buffer]);
      });
    },

    isBusy: () => busy,

    terminate(): void {
      // Anything outstanding is answered as "nothing found" so no caller is
      // left awaiting a promise that can never settle.
      for (const settle of pending.values()) settle({ text: null, format: null, ms: 0 });
      pending.clear();
      busy = false;
      worker.terminate();
    },
  };
}
