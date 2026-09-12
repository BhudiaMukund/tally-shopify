"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { InventoryMode } from "@/lib/db/schemas/inventory-events";
import type { LookupProduct, LookupVariant } from "@/lib/scan/lookup-client";

/**
 * The stocktake count: one variant, its price shown large, a deliberate count.
 *
 * The NumberField primitive has no "empty" display state — it always shows a
 * number — so instead of pre-filling it with the current on-hand (which
 * `POST /api/inventory` would then happily re-apply as a no-op tap), "Update
 * stock" stays disabled until the field has actually been touched. That is
 * what "pre-filled with nothing" (BUILD_PLAN §8) has to mean given the shared
 * component: a deliberate count, not a coincidentally-correct default.
 */

export interface CountScreenProps {
  product: LookupProduct;
  variant: LookupVariant;
  /** Digits-only, from the lookup — what the write goes to Shopify under. */
  barcode: string;
  ambiguousBarcode: boolean;
  chosenFrom: string[];
  onDone: () => void;
  onDifferentPrice: () => void;
}

interface ConflictState {
  current: number | null;
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: InventoryMode;
  onChange: (mode: InventoryMode) => void;
  disabled: boolean;
}) {
  const OPTIONS: { value: InventoryMode; label: string }[] = [
    { value: "set", label: "Set to" },
    { value: "add", label: "Add" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Count mode"
      className="border-line inline-flex rounded-md border p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-9 cursor-pointer rounded-[5px] px-3.5 text-sm font-medium transition-colors duration-120",
            "disabled:pointer-events-none disabled:opacity-50",
            mode === option.value ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/6",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CountScreen({
  product,
  variant,
  barcode,
  ambiguousBarcode,
  chosenFrom,
  onDone,
  onDifferentPrice,
}: CountScreenProps) {
  const toast = useToast();
  const [scanId, setScanId] = useState(() => crypto.randomUUID());
  const [mode, setMode] = useState<InventoryMode>("set");
  const [value, setValue] = useState(0);
  const [touched, setTouched] = useState(false);
  const [compareQuantity, setCompareQuantity] = useState(variant.available);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  async function submit() {
    setSubmitting(true);
    setConflict(null);

    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scanId,
          barcode,
          variantId: variant.variantId,
          mode,
          value,
          compareQuantity,
          ambiguousBarcode,
          chosenFrom,
        }),
      });

      if (response.status === 409) {
        const body = (await response.json()) as { current: number | null };
        setConflict({ current: body.current });
        return;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        toast({
          title: "Stock not updated",
          description: body?.message ?? "Try scanning again.",
          tone: "error",
        });
        return;
      }

      toast({ title: "Stock updated", tone: "success" });
      onDone();
    } catch {
      toast({
        title: "Stock not updated",
        description: "Check the connection and try again.",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function acceptConflict() {
    if (conflict === null) return;
    setCompareQuantity(conflict.current);
    setScanId(crypto.randomUUID());
    setConflict(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-ink-soft text-sm">{product.title}</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-ink text-2xl font-bold">
            {variant.optionLabel === "" ? "This item" : variant.optionLabel}
          </h2>
          <span className="text-ink font-mono text-2xl font-medium tabular-nums">
            ${variant.price}
          </span>
        </div>
      </div>

      <div className="bg-paper border-line flex items-center justify-between rounded-md border px-4 py-3">
        <span className="text-ink-soft text-sm">On hand</span>
        <span className="text-ink font-mono text-lg tabular-nums">
          {compareQuantity === null ? "Not tracked yet" : compareQuantity}
        </span>
      </div>

      {conflict ? (
        <div className="border-warn bg-warn/10 rounded-md border p-4">
          <p className="text-ink text-sm font-medium">
            Stock changed to{" "}
            <span className="font-mono tabular-nums">{conflict.current ?? "—"}</span> while you were
            counting.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={acceptConflict}>
            Use this instead
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <ModeToggle mode={mode} onChange={setMode} disabled={submitting} />
            <NumberField
              // Corrections that reduce stock (damage, a miscount) go through
              // "Set to" with the true total — "Add" only ever adds, matching
              // the shared field's "never negative" contract.
              label={mode === "set" ? "New count" : "Add to count"}
              value={value}
              onValueChange={(next) => {
                setValue(next);
                setTouched(true);
              }}
              disabled={submitting}
              fullWidth
            />
          </div>

          <Button
            size="touch"
            fullWidth
            loading={submitting}
            disabled={!touched}
            onClick={() => void submit()}
          >
            Update stock
          </Button>

          <button
            type="button"
            onClick={onDifferentPrice}
            className="text-ink-soft hover:text-ink -mt-2 self-center text-sm underline underline-offset-4"
          >
            Price on this one is different
          </button>
        </>
      )}
    </div>
  );
}
