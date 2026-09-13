"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PhotoCapture } from "@/components/capture/photo-capture";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { ToastProvider, useToast } from "@/components/ui/toast";
import type { CapturedPhoto } from "@/lib/capture/use-photo-capture";
import { cn } from "@/lib/cn";
import { getDeviceId } from "@/lib/device-id";
import { IntakeRequestError, submitDraft } from "@/lib/intake/submit-draft";

/**
 * The no-match capture flow (BUILD_PLAN §10): photos, then price, then
 * quantity, then optional vendor/type chips, then submit. One scrolling
 * screen rather than a wizard — `CountScreen` is the precedent for a single
 * screen carrying everything a capture needs, and a step machine would be new
 * state for no real benefit at this length.
 *
 * The same screen serves `new_variant` intake: the only difference is the
 * parent banner pinned at the top and an option-name pick in place of the
 * vendor/type chips, exactly as BUILD_PLAN §10 describes it.
 */

const REASON_COPY: Record<string, string> = {
  new: "This barcode is not in the catalogue yet.",
  "no-product-match": "None of the matched products were the right one.",
  "no-variant-match": "None of the sizes on that product were the right one.",
  "different-price": "The price on this one does not match what is on record.",
};

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

export interface IntakeParent {
  productId: string;
  productTitle: string;
  posOnly: boolean;
  optionNames: string[];
}

export interface IntakeScreenProps {
  barcode?: string;
  reason?: string;
  siblingOf?: string;
  parent: IntakeParent | null;
}

function isReadyToSubmit(photo: CapturedPhoto): boolean {
  return (
    photo.status === "uploaded" || photo.status === "failed" || photo.status === "queued-offline"
  );
}

function ChipRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string | undefined;
  onSelect: (value: string | undefined) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div>
      <p className="text-ink mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(active ? undefined : option)}
              className={cn(
                "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors duration-120",
                active
                  ? "bg-ink border-ink text-white"
                  : "bg-card text-ink-soft border-line hover:bg-paper",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IntakeForm({ barcode, reason, siblingOf, parent }: IntakeScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const kind = parent !== null ? "new_variant" : "new_product";

  const [scanId] = useState(() => crypto.randomUUID());
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [productTypeOptions, setProductTypeOptions] = useState<string[]>([]);
  const [optionNameChips, setOptionNameChips] = useState<string[]>([]);
  const [vendor, setVendor] = useState<string | undefined>(undefined);
  const [productType, setProductType] = useState<string | undefined>(undefined);
  /** Only set by an explicit chip tap — the single-option case below is derived, not stored. */
  const [pickedOptionName, setPickedOptionName] = useState<string | undefined>(undefined);

  useEffect(() => {
    const needsOptionNameChips =
      kind === "new_variant" && parent !== null && parent.optionNames.length !== 1;
    const keys =
      kind === "new_product"
        ? ["vendor", "productType"]
        : needsOptionNameChips
          ? ["optionName"]
          : [];
    if (keys.length === 0) return;

    const controller = new AbortController();
    fetch(`/api/taxonomy?keys=${keys.join(",")}`, { signal: controller.signal })
      .then((response) =>
        response.ok ? (response.json() as Promise<Record<string, string[]>>) : null,
      )
      .then((body) => {
        if (body === null) return;
        if (body.vendor) setVendorOptions(body.vendor);
        if (body.productType) setProductTypeOptions(body.productType);
        if (body.optionName) setOptionNameChips(body.optionName);
      })
      .catch(() => {
        // Chips are a shortcut, not a requirement — a taxonomy fetch failure
        // just means fewer shortcuts, not a blocked capture.
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const optionNameSource =
    parent !== null && parent.optionNames.length > 0 ? parent.optionNames : optionNameChips;
  // Auto-filled, silently, the moment there is exactly one candidate —
  // whether that's known synchronously (the parent's own option names) or
  // only once the taxonomy fetch above lands. Derived on every render rather
  // than pushed into state from an effect, so there is nothing to keep in
  // sync.
  const optionName =
    pickedOptionName ?? (optionNameSource.length === 1 ? optionNameSource[0] : undefined);

  const priceValid = PRICE_PATTERN.test(price);
  const photosReady = photos.length > 0 && photos.every(isReadyToSubmit);
  const needsOptionNamePick = kind === "new_variant" && optionName === undefined;
  const canSubmit =
    barcode !== undefined && photosReady && priceValid && !submitting && !needsOptionNamePick;

  async function submit() {
    if (barcode === undefined) return;
    setSubmitting(true);

    try {
      const base = { scanId, barcodeRaw: barcode, price, qty, deviceId: getDeviceId(), photos };
      const result = await submitDraft(
        parent === null
          ? { ...base, kind: "new_product" as const, siblingOf, vendor, productType }
          : {
              ...base,
              kind: "new_variant" as const,
              parent: {
                productId: parent.productId,
                productTitle: parent.productTitle,
                posOnly: parent.posOnly,
                // `canSubmit` already requires this to be chosen before
                // submit is reachable — see `needsOptionNamePick`.
                optionName: optionName!,
              },
            },
      );

      toast(
        result.outcome === "submitted"
          ? { title: "Product captured", tone: "success" }
          : { title: "Saved — will send when back online", tone: "info" },
      );
      router.replace("/scan");
    } catch (error) {
      toast({
        title: "Could not save this product",
        description:
          error instanceof IntakeRequestError
            ? error.message
            : "Check the connection and try again.",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-5 py-8">
      <div>
        <h1 className="font-display text-ink text-2xl font-bold">Capture</h1>
        <p className="text-ink-soft mt-2 text-sm">
          {reason !== undefined && reason in REASON_COPY ? REASON_COPY[reason] : "New capture."}
        </p>
      </div>

      {barcode !== undefined ? (
        <p className="border-line bg-card rounded-md border px-4 py-3 font-mono text-lg tabular-nums">
          {barcode}
        </p>
      ) : (
        <div className="border-stop bg-stop/8 rounded-md border p-4 text-sm">
          No barcode carried over — go back and scan the item again.
        </div>
      )}

      {parent !== null ? (
        <div className="border-line bg-paper rounded-md border p-4">
          <Badge tone="neutral">Adding to this product</Badge>
          <p className="text-ink mt-2 font-medium">{parent.productTitle}</p>
          {parent.posOnly ? (
            <p className="text-ink-soft mt-0.5 text-xs">Point of Sale only</p>
          ) : null}
        </div>
      ) : null}

      <PhotoCapture onPhotosChange={setPhotos} />

      <Input
        label="Price"
        size="touch"
        mono
        inputMode="decimal"
        prefix="$"
        placeholder="0.00"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        error={price !== "" && !priceValid ? "Enter a price like 12.50." : undefined}
      />

      <NumberField label="Quantity" value={qty} onValueChange={setQty} min={0} fullWidth />

      {kind === "new_product" ? (
        <>
          <ChipRow label="Vendor" options={vendorOptions} selected={vendor} onSelect={setVendor} />
          <ChipRow
            label="Product type"
            options={productTypeOptions}
            selected={productType}
            onSelect={setProductType}
          />
        </>
      ) : optionNameSource.length > 1 ? (
        <ChipRow
          label="Which option is this?"
          options={optionNameSource}
          selected={optionName}
          onSelect={setPickedOptionName}
        />
      ) : null}

      <Button
        size="touch"
        fullWidth
        loading={submitting}
        disabled={!canSubmit}
        onClick={() => void submit()}
      >
        Capture product
      </Button>
    </main>
  );
}

export function IntakeScreen(props: IntakeScreenProps) {
  return (
    <ToastProvider>
      <IntakeForm {...props} />
    </ToastProvider>
  );
}
