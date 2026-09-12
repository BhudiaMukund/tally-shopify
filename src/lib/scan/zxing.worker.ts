/// <reference lib="webworker" />
import { decodeFrame } from "./zxing-decode";
import type { DecodeRequest, DecodeResponse } from "./zxing-protocol";

/**
 * The fallback decoder, off the main thread.
 *
 * ZXing is pure JavaScript scanning pixel rows, which is real work — tens of
 * milliseconds a frame on a mid-range phone. On the main thread that lands
 * directly on the viewfinder, and a scanner that stutters while it decodes is
 * worse than one that is slightly slower, because the person cannot tell
 * whether it is working. Here it costs nothing visible.
 *
 * It also never enters the `/scan` bundle: the worker is its own chunk, built
 * only because of the `new Worker(new URL(…))` in `zxing-client.ts`, so the
 * 40KB budget on the scan route is unaffected by a library many times that size.
 *
 * `@zxing/browser` is the DOM wrapper around this and is no use in a worker —
 * it drives a `<video>` element. `@zxing/library` is the decoder inside it.
 *
 * This file is deliberately thin: everything worth testing is in
 * `zxing-decode.ts`, which a test runner can import without a worker.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

function handle(request: DecodeRequest): DecodeResponse {
  const startedAt = performance.now();

  try {
    const found = decodeFrame(new Uint8ClampedArray(request.buffer), request.width, request.height);
    const ms = Math.round(performance.now() - startedAt);

    return found === null
      ? { type: "empty", id: request.id, ms }
      : { type: "result", id: request.id, text: found.text, format: found.format, ms };
  } catch (error) {
    return {
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

scope.addEventListener("message", (event: MessageEvent<DecodeRequest>) => {
  scope.postMessage(handle(event.data));
});

// Told once, on load, so the main thread can report "worker up" in the debug
// panel rather than leaving a tester guessing why nothing decodes.
scope.postMessage({ type: "ready" } satisfies DecodeResponse);
