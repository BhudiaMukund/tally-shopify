/**
 * Whether the scan screen's diagnostics panel is open, remembered per device.
 *
 * An external store rather than a piece of component state read out of
 * `localStorage` in an effect. Reading storage during render is a hydration
 * mismatch waiting to happen, and setting state from an effect to correct it is
 * a cascading render — `useSyncExternalStore` is the primitive for exactly this
 * shape, and it lets the server render "closed" without anyone lying about it.
 *
 * Worth remembering at all because remote debugging does not work on the shop's
 * phone: if the app reloads mid-investigation, the panel has to still be there.
 */

const KEY = "tally.scan.debug";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToDebugPreference(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab — or the same app in a second window — toggling it.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function getDebugPreference(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode, or a webview with storage disabled.
    return false;
  }
}

/** The server has no preference, and must not guess at one. */
export function getDebugPreferenceOnServer(): boolean {
  return false;
}

export function setDebugPreference(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? "1" : "0");
  } catch {
    // Not remembered, still toggled for this visit.
  }
  notify();
}
