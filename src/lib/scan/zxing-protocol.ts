/**
 * The messages the ZXing worker and the page exchange.
 *
 * Its own module so the worker and its client share one definition without the
 * client importing the worker (which would pull ZXing into the page bundle and
 * blow the scan route's 40KB budget).
 */

export interface DecodeRequest {
  id: number;
  /** Raw RGBA from `getImageData`, transferred rather than copied. */
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export type DecodeResponse =
  | { type: "ready" }
  | { type: "result"; id: number; text: string; format: string; ms: number }
  | { type: "empty"; id: number; ms: number }
  | { type: "error"; id: number; message: string };
