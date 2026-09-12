"use client";

import { Button } from "@/components/ui/button";
import type { LookupProduct, LookupVariant } from "@/lib/scan/lookup-client";

/**
 * One barcode, several sizes of the same product (BUILD_PLAN §3's decision
 * tree — "all siblings of one product"). Price is the discriminator and stays
 * visible without being a question: it sits beside every option value here
 * exactly as it will on the count screen after picking one.
 *
 * Sorted by option label. BUILD_PLAN §14's "most recently counted" ordering
 * needs a per-variant last-count timestamp the lookup does not carry yet —
 * left for when that data exists rather than faked here.
 */
export interface VariantChooserProps {
  product: LookupProduct;
  variants: LookupVariant[];
  onChoose: (variant: LookupVariant) => void;
  onNoneOfThese: () => void;
}

export function VariantChooser({
  product,
  variants,
  onChoose,
  onNoneOfThese,
}: VariantChooserProps) {
  const sorted = [...variants].sort((a, b) => a.optionLabel.localeCompare(b.optionLabel));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-ink-soft text-sm">Which one is this?</p>
        <h2 className="font-display text-ink text-xl font-bold">{product.title}</h2>
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map((variant) => (
          <li key={variant.variantId}>
            <button
              type="button"
              onClick={() => onChoose(variant)}
              className="border-line bg-card hover:bg-paper flex min-h-14 w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-120"
            >
              <span className="text-ink font-medium">
                {variant.optionLabel === "" ? "Default" : variant.optionLabel}
              </span>
              <span className="text-ink font-mono text-lg tabular-nums">${variant.price}</span>
            </button>
          </li>
        ))}
      </ul>

      <Button variant="ghost" size="md" onClick={onNoneOfThese}>
        None of these
      </Button>
    </div>
  );
}
