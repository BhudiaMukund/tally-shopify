"use client";

import Link from "next/link";

import { PhotoCapture } from "@/components/capture/photo-capture";
import { Button } from "@/components/ui/button";

/**
 * Photo capture is real (commit 9); price, quantity and saving a draft are
 * not (commit 10). Both are true on this screen at once, so it says so rather
 * than either pretending capture is the whole feature or hiding it behind
 * another placeholder now that it works.
 */

const REASON_COPY: Record<string, string> = {
  new: "This barcode is not in the catalogue yet.",
  "no-product-match": "None of the matched products were the right one.",
  "no-variant-match": "None of the sizes on that product were the right one.",
  "different-price": "The price on this one does not match what is on record.",
};

export interface IntakeScreenProps {
  barcode?: string;
  reason?: string;
}

export function IntakeScreen({ barcode, reason }: IntakeScreenProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-5 py-8">
      <div>
        <h1 className="font-display text-ink text-2xl font-bold">Capture</h1>
        <p className="text-ink-soft mt-2 text-sm">
          {reason !== undefined && reason in REASON_COPY
            ? REASON_COPY[reason]
            : "This scan needs new-product capture."}
        </p>
      </div>

      {barcode !== undefined ? (
        <p className="border-line bg-card rounded-md border px-4 py-3 font-mono text-lg tabular-nums">
          {barcode}
        </p>
      ) : null}

      <PhotoCapture />

      <div className="border-line bg-paper rounded-md border px-4 py-3">
        <p className="text-ink-soft text-sm">
          Photos taken here upload straight away. Price, quantity and saving this as a product land
          in a later commit — nothing is submitted yet.
        </p>
      </div>

      <Link href="/scan">
        <Button variant="secondary" size="touch" fullWidth>
          Back to scanning
        </Button>
      </Link>
    </main>
  );
}
