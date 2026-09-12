/**
 * `BarcodeDetector`, which TypeScript's DOM library still does not ship.
 *
 * Part of the Shape Detection API — implemented in Chrome and Android WebView,
 * absent in Firefox and (for barcodes) in desktop Safari. That split is exactly
 * why there is a ZXing fallback, and why nothing may assume this type exists at
 * runtime just because it type-checks.
 *
 * https://wicg.github.io/shape-detection-api/
 */

interface DetectedBarcode {
  boundingBox: DOMRectReadOnly;
  cornerPoints: readonly { x: number; y: number }[];
  format: string;
  rawValue: string;
}

interface BarcodeDetectorOptions {
  formats?: readonly string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
