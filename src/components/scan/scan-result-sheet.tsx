"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ToastProvider } from "@/components/ui/toast";
import type { LookupResponse } from "@/lib/scan/lookup-client";

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
          {lookup !== null ? (
            <ScanResult lookup={lookup} reconciling={reconciling} onDone={onDone} />
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
