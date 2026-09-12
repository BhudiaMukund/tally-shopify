/**
 * The resize decision, kept pure and apart from the actual canvas work in
 * `downscale.worker.ts` — `OffscreenCanvas` and `ImageBitmap` don't exist in
 * a test runner, but the arithmetic that decides the target size does not
 * need them and is exactly the part worth getting right on its own.
 */

export interface Size {
  width: number;
  height: number;
}

/** "Max 2000px on the long edge" (BUILD_PLAN §9). */
export const MAX_LONG_EDGE = 2000;

/** WebP quality 82, as a 0–1 fraction for `OffscreenCanvas.convertToBlob`. */
export const WEBP_QUALITY = 0.82;

/**
 * Scales `source` down to fit within `maxEdge` on its longer side, preserving
 * aspect ratio. Never scales up — a photo already under the limit (a small
 * product shot, a screenshot) is left alone rather than blown up and
 * re-compressed for no benefit.
 */
export function computeTargetSize(source: Size, maxEdge: number = MAX_LONG_EDGE): Size {
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= maxEdge) return { ...source };

  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}
