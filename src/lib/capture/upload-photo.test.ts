import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_UPLOAD_ATTEMPTS, uploadPhoto } from "./upload-photo";

const BLOB = new Blob(["fake webp bytes"], { type: "image/webp" });

function signResponse(key = "intake/abc.webp") {
  return new Response(
    JSON.stringify({
      uploads: [
        { key, url: `https://s3.example/${key}`, publicUrl: `https://files.example/${key}` },
      ],
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("uploadPhoto", () => {
  it("succeeds on the first attempt without retrying", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/uploads/sign")) return Promise.resolve(signResponse());
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadPhoto(BLOB);

    expect(result).toEqual({
      key: "intake/abc.webp",
      publicUrl: "https://files.example/intake/abc.webp",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // one sign call, one PUT
  });

  it("retries a failed PUT and succeeds on the second attempt", async () => {
    let putAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/uploads/sign")) return Promise.resolve(signResponse());
      putAttempts += 1;
      if (putAttempts === 1) return Promise.resolve(new Response(null, { status: 500 }));
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = uploadPhoto(BLOB);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.key).toBe("intake/abc.webp");
    expect(putAttempts).toBe(2);
  });

  it("gives up after the configured number of attempts and throws", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/uploads/sign")) return Promise.resolve(signResponse());
      return Promise.resolve(new Response(null, { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = uploadPhoto(BLOB, { maxAttempts: 3 });
    const expectation = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await expectation;

    // One sign + one PUT per attempt, three attempts, none of them retried again.
    expect(fetchMock).toHaveBeenCalledTimes(MAX_UPLOAD_ATTEMPTS * 2);
  });

  it("fails without retrying when there is nothing to retry towards (bad server response shape)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ uploads: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = uploadPhoto(BLOB, { maxAttempts: 1 });
    await expect(promise).rejects.toThrow(/no upload url/i);
  });
});
