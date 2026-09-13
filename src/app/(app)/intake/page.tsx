import type { Metadata } from "next";

import { IntakeScreen } from "./intake-screen";

export const metadata: Metadata = { title: "Capture — Tally" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IntakePage({ searchParams }: PageProps<"/intake">) {
  const params = await searchParams;

  const parentProductId = first(params.parentProductId);
  const parentTitle = first(params.parentTitle);
  const parentOptionNames = first(params.parentOptionNames);

  // `kind` is decided from the route taken through the decision tree
  // (BUILD_PLAN §10) — a chosen product means this is a variant of it, no
  // product means a fresh capture. The server re-validates via the
  // discriminated request schema; this is only the client's half.
  const parent =
    parentProductId !== undefined && parentTitle !== undefined
      ? {
          productId: parentProductId,
          productTitle: parentTitle,
          posOnly: first(params.parentPosOnly) === "true",
          optionNames: parentOptionNames !== undefined ? parentOptionNames.split(",") : [],
        }
      : null;

  return (
    <IntakeScreen
      barcode={first(params.barcode)}
      reason={first(params.reason)}
      siblingOf={first(params.siblingOf)}
      parent={parent}
    />
  );
}
