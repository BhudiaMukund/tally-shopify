"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ToastProvider } from "@/components/ui/toast";
import type { LookupResponse } from "@/lib/scan/lookup-client";
import { distinctProductCount, reconcileProducts } from "@/lib/scan/reconcile-matches";

import { ScanResult } from "./scan-result";

/**
 * The dynamic-import boundary for everything a resolved scan needs: Radix
 * Dialog (the sheet) and Radix Toast, both real weight, neither needed until
 * the first scan actually lands — see `ManualEntry`'s identical reasoning in
 * `scan-screen.tsx`.
 *
 * `ToastProvider` lives here rather than wrapping `<ScanResult>` alone so a
 * toast fired right as the sheet closes (submit, then reset back to scanning)
 * keeps its 4s of screen time: the parent only ever toggles the *sheet's*
 * `open` prop, never unmounts this component once it has loaded once.
 *
 * `<ScanResult>` itself is mounted only once `reconciling` is false. It
 * decides its branch (chooser vs. count screen) exactly once, in a `useState`
 * initialiser, on the theory that once a scan is confirmed nothing should
 * change under a tap in progress — but that same one-shot decision is wrong
 * to make from the cached-only answer, which is allowed to be stale or (per
 * the bug this fixes) briefly empty while Shopify hasn't been asked yet. So
 * this sheet shows a lightweight, non-committal preview from the cached
 * answer while `reconciling`, and only hands the real data to `ScanResult`
 * once Shopify has confirmed it.
 */
export interface ScanResultSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookup: LookupResponse | null;
  /** Set once both requests have failed — `lookup` stays null in that case. */
  error: string | null;
  reconciling: boolean;
  onDone: () => void;
}

function ConfirmingPreview({ lookup }: { lookup: LookupResponse }) {
  const products = reconcileProducts(lookup.products);
  const single = distinctProductCount(products) === 1 ? products[0] : undefined;

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Spinner size="md" />
      {single !== undefined ? (
        <div>
          <p className="text-ink font-medium">{single.title}</p>
          <p className="text-ink-soft text-sm">Confirming with Shopify…</p>
        </div>
      ) : (
        <p className="text-ink-soft text-sm">Confirming with Shopify…</p>
      )}
    </div>
  );
}

export function ScanResultSheet({
  open,
  onOpenChange,
  lookup,
  error,
  reconciling,
  onDone,
}: ScanResultSheetProps) {
  return (
    <ToastProvider>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent title="Scan result" hideTitle>
          {lookup !== null && !reconciling ? (
            <ScanResult lookup={lookup} onDone={onDone} />
          ) : lookup !== null ? (
            <ConfirmingPreview lookup={lookup} />
          ) : error !== null ? (
            <div className="flex flex-col gap-3">
              <p className="text-ink">Could not look this up: {error}</p>
              <Button variant="secondary" size="touch" fullWidth onClick={onDone}>
                Scan again
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </ToastProvider>
  );
}
