/**
 * A per-phone identifier for `drafts.deviceId` — who captured this, at a
 * finer grain than the signed-in account (one login, several shared phones).
 * Generated once and kept in `localStorage`, never sent anywhere but the
 * intake payload.
 */

const STORAGE_KEY = "tally-device-id";

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing !== null) return existing;

    const created = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Private browsing or storage disabled — a per-session id beats a crash.
    return crypto.randomUUID();
  }
}
