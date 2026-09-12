import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Capture — Tally" };

/**
 * A placeholder, not a feature. `POST /api/intake` and the capture flow are
 * commits 9–10 — photos, price, quantity, the offline queue. Every escape on
 * the scan screen's decision tree (no match, "none of these", "price is
 * different") already has to go somewhere, so this exists to be that
 * somewhere honestly rather than a 404 or a silently swallowed tap.
 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const REASON_COPY: Record<string, string> = {
  new: "This barcode is not in the catalogue yet.",
  "no-product-match": "None of the matched products were the right one.",
  "no-variant-match": "None of the sizes on that product were the right one.",
  "different-price": "The price on this one does not match what is on record.",
};

export default async function IntakePage({ searchParams }: PageProps<"/intake">) {
  const params = await searchParams;
  const barcode = first(params.barcode);
  const reason = first(params.reason);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-5 py-10">
      <div>
        <h1 className="font-display text-ink text-2xl font-bold">Capture isn&rsquo;t built yet</h1>
        <p className="text-ink-soft mt-2 text-sm">
          {reason !== undefined && reason in REASON_COPY
            ? REASON_COPY[reason]
            : "This scan needs new-product capture."}{" "}
          Photo capture and the review queue land in a later commit — for now this item can&rsquo;t
          be added from the phone.
        </p>
      </div>

      {barcode !== undefined ? (
        <p className="border-line bg-card rounded-md border px-4 py-3 font-mono text-lg tabular-nums">
          {barcode}
        </p>
      ) : null}

      <Link href="/scan">
        <Button size="touch" fullWidth>
          Back to scanning
        </Button>
      </Link>
    </main>
  );
}
