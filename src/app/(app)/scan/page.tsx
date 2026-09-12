import type { Metadata } from "next";

import { parseEngineRequest } from "@/lib/scan/engine";

import { ScanScreen } from "./scan-screen";

export const metadata: Metadata = { title: "Scan — Tally" };

/**
 * `/scan` — the hot path.
 *
 * A server component whose only job is to read the two query parameters, so the
 * client island never has to suspend on `useSearchParams` before it can start a
 * camera. Everything below here is interaction.
 *
 *   ?engine=zxing   force the ZXing fallback (Android Chrome has a native
 *                   detector, so the fallback never runs here on its own)
 *   ?engine=native  force the native detector
 *   ?debug=1        open the diagnostics panel on load
 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ScanPage({ searchParams }: PageProps<"/scan">) {
  const params = await searchParams;
  const requested = parseEngineRequest(
    first(params.engine) ?? process.env.NEXT_PUBLIC_SCANNER_ENGINE,
  );

  return <ScanScreen engine={requested} debug={first(params.debug) === "1"} />;
}
