"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ToastProvider, useToast } from "@/components/ui/toast";

/** Shows the controlled API and the tick of motion on every change. */
export function CountDemo() {
  const [count, setCount] = useState(24);
  const onHand = 24;
  const delta = count - onHand;

  return (
    <div className="flex flex-wrap items-end gap-6">
      <NumberField
        label="New count"
        value={count}
        onValueChange={setCount}
        max={999}
        hint="Hold − or + to run the count."
      />
      <dl className="pb-1.5">
        <dt className="text-ink-soft text-xs">On hand in Shopify</dt>
        <dd className="text-ink font-mono text-2xl font-medium tabular-nums">{onHand}</dd>
        <dd className="mt-2">
          {delta === 0 ? (
            <Badge tone="neutral">No change</Badge>
          ) : (
            <Badge tone={delta > 0 ? "matched" : "failed"} mono>
              {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
            </Badge>
          )}
        </dd>
      </dl>
    </div>
  );
}

export function SheetDemo() {
  return (
    <div className="flex flex-wrap gap-3">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary">Open bottom sheet</Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          title="Three variants share this barcode"
          description="Pick the one in your hand. The price is the discriminator."
          footer={
            <SheetClose asChild>
              <Button variant="ghost" size="touch" fullWidth>
                None of these
              </Button>
            </SheetClose>
          }
        >
          <ul className="divide-line divide-y">
            {[
              { size: "Small, 15cm", price: "1.50" },
              { size: "Medium, 25cm", price: "2.75" },
              { size: "Large, 45cm", price: "4.00" },
            ].map((variant) => (
              <li key={variant.size}>
                <SheetClose asChild>
                  <button
                    type="button"
                    className="hover:bg-paper flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left transition-colors"
                  >
                    <span className="text-ink text-base">{variant.size}</span>
                    <span className="text-ink font-mono text-lg font-medium tabular-nums">
                      £{variant.price}
                    </span>
                  </button>
                </SheetClose>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary">Open side panel</Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          title="Foil balloon, star, gold 45cm"
          description="Drafted by Gemini Flash. Nothing here is published yet."
          footer={
            <div className="flex gap-3">
              <SheetClose asChild>
                <Button variant="secondary" fullWidth>
                  Reject
                </Button>
              </SheetClose>
              <SheetClose asChild>
                <Button fullWidth>Approve draft</Button>
              </SheetClose>
            </div>
          }
        >
          <div className="space-y-4">
            <Badge tone="queued" size="md">
              Waiting for review
            </Badge>
            <p className="text-ink-soft text-sm">
              A side panel keeps the review list on screen beside it, so keyboard navigation never
              loses its place.
            </p>
            <dl className="border-line divide-line divide-y border-t text-sm">
              {[
                ["Barcode", "50123456789012"],
                ["Price", "£4.00"],
                ["Counted", "12"],
              ].map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink-soft">{key}</dt>
                  <dd className="text-ink font-mono tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ToastButtons() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            tone: "success",
            title: "Stock updated",
            description: "Foil balloon, star, gold 45cm is now 36.",
          })
        }
      >
        Update stock
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            tone: "error",
            title: "Count rejected",
            description: "A till sale changed the quantity mid-count. Rescan and count again.",
            action: { label: "Rescan", onClick: () => {} },
          })
        }
      >
        Trigger a conflict
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            tone: "info",
            title: "Sent for review",
            description: "3 products queued.",
          })
        }
      >
        Send for review
      </Button>
    </div>
  );
}

export function ToastDemo() {
  return (
    <ToastProvider>
      <ToastButtons />
    </ToastProvider>
  );
}

/** The loading state is only honest if you can watch it start. */
export function LoadingButtonDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="touch"
      loading={busy}
      onClick={() => {
        setBusy(true);
        setTimeout(() => setBusy(false), 1800);
      }}
    >
      {busy ? "Updating stock" : "Update stock"}
    </Button>
  );
}
