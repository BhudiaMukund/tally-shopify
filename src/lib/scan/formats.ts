/**
 * The symbologies worth decoding here, and what each engine calls them.
 *
 * Narrowing the list is not tidiness — it is most of the speed. ZXing tries
 * every format it is given on every frame, and leaving QR and the postal
 * symbologies in costs frames per second for codes this shop will never scan.
 *
 * Retail GTINs are the job (EAN-13 and its shorter forms). Code 128 and ITF are
 * in because carton labels use them and a delivery gets scanned off the box.
 */

/** `BarcodeDetector`'s spelling. https://wicg.github.io/shape-detection-api/ */
export const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] as const;

/**
 * The ones worth having before the native detector is preferred over ZXing.
 * A detector that cannot read an EAN-13 cannot read this catalogue.
 */
export const REQUIRED_NATIVE_FORMATS = ["ean_13", "upc_a"] as const;

/** `@zxing/library`'s `BarcodeFormat` names, resolved against the enum in the worker. */
export const ZXING_FORMATS = ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "ITF"] as const;
