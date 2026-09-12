"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { normaliseBarcode } from "@/lib/barcode";

/**
 * Typing the barcode when the camera cannot read it.
 *
 * Not a fallback for a broken app — a torn label, a code printed on a curved
 * foil balloon, a permission that has not been granted yet. It is always
 * available, which is what makes every other failure here non-blocking.
 */

export interface ManualEntryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns false when the debounce swallowed it, so the sheet can say so. */
  onSubmit: (barcode: string) => boolean;
}

/** Says what is wrong without refusing the entry — a carton label is not a GTIN. */
function hintFor(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const normalised = normaliseBarcode(trimmed);
  if (normalised.problem === "length") {
    return `That is ${normalised.digits.length} digits. Printed barcodes have 8, 12, 13 or 14.`;
  }
  if (normalised.problem === "check-digit") {
    return "The last digit does not match the rest. Check it before you count against it.";
  }
  return undefined;
}

export function ManualEntry({ open, onOpenChange, onSubmit }: ManualEntryProps) {
  const [value, setValue] = useState("");
  const [repeated, setRepeated] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") return;

    if (onSubmit(trimmed)) {
      setValue("");
      setRepeated(false);
      onOpenChange(false);
      return;
    }
    // The gate swallowed it: the same code went through moments ago.
    setRepeated(true);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setRepeated(false);
        onOpenChange(next);
      }}
    >
      <SheetContent
        title="Enter the barcode"
        description="Read the digits printed under the bars."
        footer={
          <Button type="submit" form="manual-barcode" size="touch" fullWidth>
            Find this barcode
          </Button>
        }
      >
        <form id="manual-barcode" onSubmit={submit} className="px-5 pb-2">
          <Input
            label="Barcode"
            hideLabel
            size="touch"
            mono
            autoFocus
            // The numeric keypad, not the full keyboard: every printed barcode
            // is digits, and the keys are four times the size.
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="9312345678907"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setRepeated(false);
            }}
            hint={hintFor(value)}
            error={
              repeated ? "That barcode was just scanned. It has not been counted twice." : undefined
            }
          />
        </form>
      </SheetContent>
    </Sheet>
  );
}
