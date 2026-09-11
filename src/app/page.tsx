import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <h1 className="font-display text-ink text-5xl font-bold">Tally</h1>
      <p className="text-ink-soft mt-3 max-w-prose text-base">
        Stock and product intake for the stockroom. Scan a barcode to count what is on the shelf, or
        capture a product that is not in the catalogue yet.
      </p>
      <div className="mt-8">
        <Link href="/kitchen-sink" className={buttonClassName({ variant: "secondary" })}>
          Open the design system
        </Link>
      </div>
    </main>
  );
}
