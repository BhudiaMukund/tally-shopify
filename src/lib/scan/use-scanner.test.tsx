// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanEvent } from "./types";
import { useScanner } from "./use-scanner";

/**
 * Written after a report of Chrome (not Firefox) never showing the camera
 * permission prompt and `/scan` cycling rapidly on the button that starts it —
 * a symptom shaped exactly like a `useState`-backed re-entry guard, or an
 * unstable `useCallback` dependency, tripping React's Strict Mode double
 * invoke (on by default for the App Router here — `next.config.ts` doesn't
 * set `reactStrictMode`, and Next.js's default for it is `true`).
 *
 * It could not be reproduced against this file's committed code: headless
 * Chrome over CDP with a fake camera, and a real headed Chrome window with the
 * permission decision genuinely left pending for several seconds, both show
 * exactly one `getUserMedia` call. Reading the hook, `starting` is already a
 * ref (not state, so setting it doesn't re-render and re-enter), and the
 * `startCamera → pump → decodeFrame → emit → ensureCanvas` callback chain has
 * no dependency that changes identity across a render.
 *
 * These tests exist to say so with evidence rather than a paragraph of
 * reasoning, and to stay red if that ever stops being true. `StrictMode` here
 * is React's own double-invoke, not a simulation of it; jsdom plus
 * `@testing-library/react` is a real environment to drive rather than a
 * hand-rolled mock of React's effect scheduling.
 */

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => { width: number; height: number };
}

function fakeStream(): { getTracks: () => FakeTrack[]; getVideoTracks: () => FakeTrack[] } {
  const track: FakeTrack = {
    stop: vi.fn(),
    getSettings: () => ({ width: 1280, height: 720 }),
  };
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

/** The same shape `ScanScreen` uses: a video element, camera started on mount. */
function Harness({ onScan }: { onScan: (event: ScanEvent) => void }) {
  const { videoRef, startCamera } = useScanner({ onScan });
  useEffect(() => {
    startCamera();
  }, [startCamera]);
  return <video ref={videoRef} muted playsInline />;
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  // jsdom leaves `isSecureContext` undefined rather than true for its default
  // http://localhost origin — `cameraSupported()` reads it directly, and a
  // falsy value there fails the whole scenario before `getUserMedia` is ever
  // reached, silently, with no assertion pointing at why.
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  // jsdom has no media pipeline; both are unimplemented there and throw.
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  // jsdom has no canvas backend and logs a "Not implemented" warning to its
  // own virtual console (not `console.error`) every time this is called.
  // decodeFrame() already handles a null context by no-op'ing — nothing under
  // test reads a decoded frame — so returning null quietly is the correct
  // behaviour here, not a workaround for one.
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useScanner + StrictMode", () => {
  it("opens the camera exactly once across React's built-in mount/cleanup/mount", async () => {
    render(
      <StrictMode>
        <Harness onScan={() => undefined} />
      </StrictMode>,
    );

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    // Give any further microtask a chance to run — this is the assertion that
    // would actually catch the regression: a `useState` guard, or a callback
    // dependency that changes identity across the double-invoke, shows up here
    // as a second call.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("useScanner across a genuine unmount and remount", () => {
  it("stops the stream's tracks on unmount rather than leaving it open", async () => {
    const { unmount } = render(<Harness onScan={() => undefined} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    const opened = await getUserMedia.mock.results[0]!.value;
    const track = opened.getTracks()[0] as FakeTrack;
    expect(track.stop).not.toHaveBeenCalled();

    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh camera on the next real mount rather than colliding with the last one", async () => {
    const first = render(<Harness onScan={() => undefined} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<Harness onScan={() => undefined} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });

  it("does not resurrect the camera when getUserMedia resolves after unmount", async () => {
    // The permission decision is still pending when the component goes away —
    // `startCamera`'s async body reads `videoRef.current` when it wakes back
    // up, which unmounting has already set to null, and stops what arrived
    // rather than acting on it.
    let resolveMedia!: (stream: unknown) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMedia = resolve;
        }),
    );

    const { unmount } = render(<Harness onScan={() => undefined} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    unmount();

    const stream = fakeStream();
    await act(async () => {
      resolveMedia(stream);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stream that arrived too late is stopped rather than left running.
    const track = stream.getTracks()[0] as FakeTrack;
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("does not carry a stale attempt over once video.play() resolves after unmount", async () => {
    // The other half of the same race, one `await` later: the stream opened
    // and was assigned to the video element, but playback was still starting
    // when the component went away.
    let resolvePlay!: () => void;
    window.HTMLMediaElement.prototype.play = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    const { unmount } = render(<Harness onScan={() => undefined} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    const opened = await getUserMedia.mock.results[0]!.value;
    const track = opened.getTracks()[0] as FakeTrack;

    unmount();
    // The unmount cleanup already knows about this stream — it was assigned
    // to `stream.current` before `play()` was ever called — and stops it.
    expect(track.stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePlay();
      await Promise.resolve();
      await Promise.resolve();
    });

    // `pump()`'s own "no video element, do nothing" check is what the resumed
    // async body runs into next — `videoRef.current` is already null post
    // -unmount — so nothing past that point fires again: no second stop, and
    // certainly no second camera.
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
