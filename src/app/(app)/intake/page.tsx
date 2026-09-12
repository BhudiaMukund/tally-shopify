import type { Metadata } from "next";

import { IntakeScreen } from "./intake-screen";

export const metadata: Metadata = { title: "Capture — Tally" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IntakePage({ searchParams }: PageProps<"/intake">) {
  const params = await searchParams;
  return <IntakeScreen barcode={first(params.barcode)} reason={first(params.reason)} />;
}
