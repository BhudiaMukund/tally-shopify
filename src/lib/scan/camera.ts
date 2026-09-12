import type { CameraState } from "./types";

/**
 * Getting the back camera, and saying something useful when we cannot.
 *
 * "Handle camera permission denial with an instruction, not an error" is a
 * design rule (CLAUDE.md), and it needs the *reason* to write the right
 * instruction: a person who tapped Block needs the padlock menu, a person whose
 * camera is held by another app needs to close it, and someone on a laptop with
 * no rear camera needs to be told to type the barcode instead.
 */

/**
 * Asked for, not demanded. `facingMode: { exact: 'environment' }` fails outright
 * on a laptop, and a laptop is where this gets developed.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    // A barcode is a few pixels per bar at arm's length. 1080p is what makes
    // the downscaled decode frame still hold a dense EAN-13.
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

export interface CameraFailure {
  state: Extract<CameraState, "denied" | "unavailable">;
  /** Shown on screen. Says what happened and what to do about it. */
  title: string;
  instruction: string;
  /** The underlying name, for the debug panel. */
  detail: string;
}

/**
 * Maps a `getUserMedia` rejection onto something a person can act on.
 *
 * The names come from the Media Capture spec's error table; browsers are
 * reasonably consistent about them, and the default branch is written so that
 * an unfamiliar one still produces an instruction rather than a stack trace.
 */
export function describeCameraFailure(error: unknown): CameraFailure {
  const name = error instanceof DOMException ? error.name : "";
  const detail = name === "" ? String(error) : name;

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        state: "denied",
        title: "Camera is off for this site",
        instruction:
          "Tap the padlock in the address bar, turn Camera on, then tap Use camera again. " +
          "You can type the barcode instead in the meantime.",
        detail,
      };

    case "NotFoundError":
    case "OverconstrainedError":
      return {
        state: "unavailable",
        title: "No camera on this device",
        instruction: "Type the barcode, or plug in a scanner and scan straight into this screen.",
        detail,
      };

    case "NotReadableError":
    case "AbortError":
      return {
        state: "unavailable",
        title: "Another app is using the camera",
        instruction: "Close the other app, then tap Use camera again.",
        detail,
      };

    default:
      return {
        state: "unavailable",
        title: "The camera would not start",
        instruction: "Type the barcode to carry on, or reload the page to try the camera again.",
        detail,
      };
  }
}

/** True when the page can ask for a camera at all. A phone on http cannot. */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    (typeof window === "undefined" || window.isSecureContext)
  );
}

export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
}

export function closeCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** What the camera actually gave us, which is rarely what was asked for. */
export function streamResolution(stream: MediaStream | null): string | null {
  const settings = stream?.getVideoTracks()[0]?.getSettings();
  if (settings?.width === undefined || settings.height === undefined) return null;
  return `${settings.width}x${settings.height}`;
}
