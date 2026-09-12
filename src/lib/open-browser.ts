import { spawn } from "node:child_process";

/**
 * Handing a URL to the desktop browser.
 *
 * Its own module, free of side effects, because the Windows path is a trap
 * worth testing: `cmd /c start "" <url>` treats `&` as a command separator, so
 * a URL with query parameters arrives at the browser truncated at the first one
 * — an authorize URL becomes `?client_id=…` with no scope, no redirect_uri and
 * no state, while cmd tries to run `scope=…` as a program. Everything after the
 * first `&` is lost silently, which reads as a misconfigured app rather than as
 * a mangled command line.
 */

/**
 * The command and arguments for one platform. Pure, so a test can assert the
 * URL survives as a single argument.
 *
 * `rundll32 url.dll,FileProtocolHandler` is Windows' documented URL opener and
 * takes the URL as one argument. Spawned directly, with no shell in between,
 * nothing re-parses it.
 */
export function browserCommand(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: string[] } {
  switch (platform) {
    case "win32":
      return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
    case "darwin":
      return { command: "open", args: [url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

/** Best effort. Callers print the URL too, so a failure here costs nothing. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const { command, args } = browserCommand(platform, url);
  try {
    // No `shell: true`. A shell is exactly what mangles the query string.
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // The URL has already been printed; opening it is a convenience.
  }
}
