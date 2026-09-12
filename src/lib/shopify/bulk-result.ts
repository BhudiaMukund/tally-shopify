import { createInterface } from "node:readline";

import { request } from "undici";

import {
  getBulkOperation,
  isTerminal,
  runBulkQuery,
  type BulkOperation,
} from "./operations/bulk-operation";

/**
 * Running a bulk query end to end: start it, wait for it, read the file.
 *
 * Shared by `pnpm taxonomy:sync` and `pnpm mirror:backfill`. One poller, not
 * two, because the thing worth getting right is *which* operation is being
 * polled — `node(id:)` asks after ours, while `currentBulkOperation`
 * (deprecated in 2026-07) and `bulkOperations` both answer "the newest one",
 * which stops being the same question the moment the other script is running.
 *
 * https://shopify.dev/docs/api/usage/bulk-operations/queries
 */

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Called only when the status or the object count actually changed. */
  onProgress?: (operation: BulkOperation) => void;
}

export async function waitForBulkOperation(
  id: string,
  { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS, onProgress }: WaitOptions = {},
): Promise<BulkOperation> {
  const deadline = Date.now() + timeoutMs;
  let last = "";

  for (;;) {
    const operation = await getBulkOperation(id);

    // This loop runs for minutes; only report when something moved.
    const signature = `${operation.status}:${operation.objectCount}`;
    if (signature !== last) {
      onProgress?.(operation);
      last = signature;
    }

    if (isTerminal(operation.status)) return operation;
    if (Date.now() > deadline) {
      throw new Error(
        `Bulk operation ${id} still ${operation.status} after ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    await sleep(intervalMs);
  }
}

/** Streams the JSONL rather than buffering it — the whole catalogue is in there. */
export async function streamBulkJsonl(
  url: string,
  onLine: (value: unknown) => void,
): Promise<number> {
  const response = await request(url, { method: "GET" });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Downloading the bulk result failed: HTTP ${response.statusCode}`);
  }

  const lines = createInterface({ input: response.body, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      onLine(JSON.parse(trimmed));
    } catch {
      throw new Error(`Bulk result line ${lineNumber} is not valid JSON.`);
    }
  }

  return lineNumber;
}

export interface RunBulkOptions extends WaitOptions {
  /** Called once the operation has finished and before the file is read. */
  onComplete?: (operation: BulkOperation) => void;
}

/**
 * Start, wait, stream. Throws with the operation's own error code when it did
 * not complete, because a partial sync written as if it were whole is worse
 * than no sync at all.
 */
export async function runBulkQueryAndStream(
  query: string,
  onLine: (value: unknown) => void,
  options: RunBulkOptions = {},
): Promise<BulkOperation> {
  const started = await runBulkQuery(query);
  const finished = await waitForBulkOperation(started.id, options);

  if (finished.status !== "COMPLETED") {
    throw new Error(
      `Bulk operation ${finished.status}${finished.errorCode === null ? "" : ` (${finished.errorCode})`}. ` +
        "Nothing was written.",
    );
  }
  if (finished.url === null) {
    // A store with no products completes with no file. Not an error in itself,
    // but writing empty results over yesterday's would be.
    throw new Error("The bulk operation completed with no result file. Nothing was written.");
  }

  options.onComplete?.(finished);
  await streamBulkJsonl(finished.url, onLine);
  return finished;
}
