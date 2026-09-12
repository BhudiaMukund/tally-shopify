"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  allVariants,
  type LookupProduct,
  type LookupResponse,
  type LookupVariant,
} from "@/lib/scan/lookup-client";

import { CountScreen } from "./count-screen";
import { ProductChooser } from "./product-chooser";
import { VariantChooser } from "./variant-chooser";

/**
 * The scan decision tree from BUILD_PLAN §3, past the lookup itself: which
 * screen a `match`, `pending` or `new` answer turns into.
 *
 * `new_variant` and `new_product` intake are commit 9–10, not this one — every
 * escape here ("none of these", "price is different", "capture new product")
 * still goes to `/intake` so nothing dead-ends, but that route is a
 * placeholder until those commits land.
 */

export interface ScanResultProps {
  lookup: LookupResponse;
  /** The cached answer painted; the live Shopify one has not confirmed it yet. */
  reconciling: boolean;
  onDone: () => void;
}

type Selection =
  | { step: "product" }
  | { step: "variant"; product: LookupProduct }
  | {
      step: "count";
      product: LookupProduct;
      variant: LookupVariant;
      ambiguousBarcode: boolean;
      chosenFrom: string[];
    };

function initialSelection(products: readonly LookupProduct[]): Selection {
  if (products.length !== 1) return { step: "product" };
  const [product] = products;
  if (product === undefined) return { step: "product" };
  if (product.variants.length !== 1) return { step: "variant", product };
  const [variant] = product.variants;
  return variant === undefined
    ? { step: "product" }
    : { step: "count", product, variant, ambiguousBarcode: false, chosenFrom: [] };
}

export function ScanResult({ lookup, reconciling, onDone }: ScanResultProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection>(() => initialSelection(lookup.products));

  function toIntake(reason: string) {
    router.push(`/intake?barcode=${encodeURIComponent(lookup.barcode)}&reason=${reason}`);
  }

  if (lookup.state === "invalid") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-ink">
          <span className="font-mono">{lookup.raw}</span> is not a barcode Tally recognises.
        </p>
        <Button variant="secondary" size="touch" fullWidth onClick={onDone}>
          Scan again
        </Button>
      </div>
    );
  }

  if (lookup.state === "new") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-ink-soft text-sm">Not in the catalogue</p>
          <p className="text-ink font-mono text-xl tabular-nums">{lookup.barcode}</p>
        </div>
        <Button size="touch" fullWidth onClick={() => toIntake("new")}>
          Capture new product
        </Button>
        <Button variant="ghost" size="md" onClick={onDone}>
          Scan again
        </Button>
      </div>
    );
  }

  if (lookup.state === "pending") {
    const [pending] = lookup.pending;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-ink-soft text-sm">Already captured — not in Shopify yet</p>
        <p className="text-ink font-medium capitalize">
          {pending?.status.replace(/_/g, " ") ?? "In review"}
        </p>
        {pending?.error !== null && pending?.error !== undefined ? (
          <p className="text-stop text-sm">{pending.error.message}</p>
        ) : null}
        <p className="text-ink-soft text-sm">
          Adding to this item&rsquo;s count is not built yet — capturing it again is not needed.
        </p>
        <Button variant="secondary" size="touch" fullWidth onClick={onDone}>
          Scan again
        </Button>
      </div>
    );
  }

  const allMatched = allVariants(lookup.products);
  const ambiguousBarcode = allMatched.length > 1;
  const chosenFrom = ambiguousBarcode ? allMatched.map((variant) => variant.variantId) : [];

  return (
    <>
      {reconciling ? <p className="text-ink-soft mb-3 text-xs">Confirming with Shopify…</p> : null}

      {selection.step === "product" ? (
        <ProductChooser
          products={lookup.products}
          onChoose={(product) => {
            const [only, second] = product.variants;
            setSelection(
              only !== undefined && second === undefined
                ? { step: "count", product, variant: only, ambiguousBarcode, chosenFrom }
                : { step: "variant", product },
            );
          }}
          onNoneOfThese={() => toIntake("no-product-match")}
        />
      ) : selection.step === "variant" ? (
        <VariantChooser
          product={selection.product}
          variants={selection.product.variants}
          onChoose={(variant) =>
            setSelection({
              step: "count",
              product: selection.product,
              variant,
              ambiguousBarcode,
              chosenFrom,
            })
          }
          onNoneOfThese={() => toIntake("no-variant-match")}
        />
      ) : (
        <CountScreen
          product={selection.product}
          variant={selection.variant}
          barcode={lookup.barcode}
          ambiguousBarcode={selection.ambiguousBarcode}
          chosenFrom={selection.chosenFrom}
          onDone={onDone}
          onDifferentPrice={() => toIntake("different-price")}
        />
      )}
    </>
  );
}
