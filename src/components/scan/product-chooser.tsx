"use client";

import Image from "next/image";

import { Button } from "@/components/ui/button";
import type { LookupProduct } from "@/lib/scan/lookup-client";

/**
 * The barcode matched more than one *product* — a data error (BUILD_PLAN §3),
 * not the normal size-run case `VariantChooser` handles. `GET /api/lookup`
 * already logged this as `catalog.barcode_collision` for cleanup; this is just
 * the least-bad thing to show someone holding the item right now.
 */
export interface ProductChooserProps {
  products: LookupProduct[];
  onChoose: (product: LookupProduct) => void;
  onNoneOfThese: () => void;
}

export function ProductChooser({ products, onChoose, onNoneOfThese }: ProductChooserProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-ink-soft text-sm">This barcode is on more than one product</p>
        <h2 className="font-display text-ink text-xl font-bold">Which one is this?</h2>
      </div>

      <ul className="flex flex-col gap-2">
        {products.map((product) => {
          const firstPrice = product.variants[0]?.price;
          return (
            <li key={product.productId}>
              <button
                type="button"
                onClick={() => onChoose(product)}
                className="border-line bg-card hover:bg-paper flex min-h-14 w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors duration-120"
              >
                {product.imageUrl === null ? (
                  <span aria-hidden="true" className="bg-paper size-11 shrink-0 rounded-sm" />
                ) : (
                  <Image
                    src={product.imageUrl}
                    alt=""
                    width={44}
                    height={44}
                    className="size-11 shrink-0 rounded-sm object-cover"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate font-medium">{product.title}</span>
                  {product.vendor !== null ? (
                    <span className="text-ink-soft block truncate text-xs">{product.vendor}</span>
                  ) : null}
                </span>
                {firstPrice !== undefined ? (
                  <span className="text-ink font-mono text-base tabular-nums">${firstPrice}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <Button variant="ghost" size="md" onClick={onNoneOfThese}>
        None of these
      </Button>
    </div>
  );
}
