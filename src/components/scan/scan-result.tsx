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
import { distinctProductCount, reconcileProducts } from "@/lib/scan/reconcile-matches";

import { CountScreen } from "./count-screen";
import { PendingDraft } from "./pending-draft";
import { ProductChooser } from "./product-chooser";
import { VariantChooser } from "./variant-chooser";

/**
 * The scan decision tree from BUILD_PLAN §3, past the lookup itself: which
 * screen a `match`, `pending` or `new` answer turns into.
 *
 * Only ever mounted once the live Shopify answer has confirmed the result
 * (`ScanResultSheet` holds back on rendering this while `reconciling` is
 * true) — the branch below is decided exactly once, in `useState`'s
 * initialiser, and a component that could be handed a still-unconfirmed
 * cached-only snapshot would freeze that decision on data that might be
 * wrong. That happened: a cached-only bug once answered with an empty product
 * list, this decided "not one product" from it, and the correct answer
 * arriving a moment later could no longer change a decision already made
 * (see `src/lib/catalog/lookup.test.ts` for the reproduction). Deciding only
 * from the confirmed answer also matches CLAUDE.md §1: the quantity
 * `CountScreen` seeds `compareQuantity` from must never come from the mirror.
 *
 * `new_variant` and `new_product` intake are commit 9–10, not this one — every
 * escape here ("none of these", "price is different", "capture new product")
 * still goes to `/intake` so nothing dead-ends, but that route is a
 * placeholder until those commits land.
 */

export interface ScanResultProps {
  lookup: LookupResponse;
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

/**
 * `products` must already be the reconciled, invariant-checked list —
 * dedupe-by-variant, group-by-product — not a raw response taken on trust.
 * The branch turns on *distinct product count*, never a response's
 * `.length`, which a duplicate row would inflate without there being two
 * products to choose between.
 */
function initialSelection(products: readonly LookupProduct[]): Selection {
  if (distinctProductCount(products) !== 1) return { step: "product" };
  const [product] = products;
  if (product === undefined) return { step: "product" };
  if (product.variants.length !== 1) return { step: "variant", product };
  const [variant] = product.variants;
  return variant === undefined
    ? { step: "product" }
    : { step: "count", product, variant, ambiguousBarcode: false, chosenFrom: [] };
}

export function ScanResult({ lookup, onDone }: ScanResultProps) {
  const router = useRouter();
  const products = reconcileProducts(lookup.products);
  const [selection, setSelection] = useState<Selection>(() => initialSelection(products));

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
    if (pending === undefined) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-ink">Something is already on its way for this barcode.</p>
          <Button variant="secondary" size="touch" fullWidth onClick={onDone}>
            Scan again
          </Button>
        </div>
      );
    }
    return <PendingDraft pending={pending} barcode={lookup.barcode} onDone={onDone} />;
  }

  const allMatched = allVariants(products);
  const ambiguousBarcode = allMatched.length > 1;
  const chosenFrom = ambiguousBarcode ? allMatched.map((variant) => variant.variantId) : [];

  return (
    <>
      {selection.step === "product" ? (
        <ProductChooser
          products={products}
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
