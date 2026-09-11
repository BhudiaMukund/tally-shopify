import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

/**
 * Headings, the wordmark and the scan-result title. Loaded at the two weights
 * the design uses and nothing else — see docs/BUILD_PLAN.md §4.
 *
 * Bricolage is a variable font with `wdth` and `opsz` axes, but `next/font`
 * only exposes extra axes when the weight range is left unpinned, and pinning
 * the weights is the stronger of the two rules. Tightness at display sizes
 * comes from the negative letter-spacing baked into the type scale instead.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

/** Body, labels, forms. Real tabular figures, holds up at 14px on a phone. */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/** Numerals only: barcodes, SKUs, quantity deltas, prices. Never UI labels. */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tally",
  description: "Stock and product intake",
  applicationName: "Tally",
};

export const viewport: Viewport = {
  themeColor: "#eef1f5",
  // The scan screen is full-bleed behind the status bar.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="bg-paper text-ink flex min-h-full flex-col">{children}</body>
    </html>
  );
}
