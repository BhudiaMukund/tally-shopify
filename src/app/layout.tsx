import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { RegisterServiceWorker } from "@/components/pwa/register-sw";

import "./globals.css";

/**
 * Headings, the wordmark and the scan-result title — see docs/BUILD_PLAN.md §4.
 *
 * The weight range is deliberately left unpinned: `next/font` only serves the
 * extra axes when it is. `wdth` runs 75–100 — 100 is the default, so the axis
 * condenses rather than expands — and carries the tightness at display sizes
 * that letter-spacing alone can only imitate. See the pairing table beside the
 * type scale in `globals.css`.
 *
 * `opsz` is left off on purpose. Measured on the latin subset: pinned weights
 * are 41KB, `wdth` alone is 78KB, and `wdth` + `opsz` is 132KB. Automatic
 * optical sizing is not worth 53KB on the scan path when every display step
 * already gets its width and tracking set by hand.
 *
 * The design still uses two weights and only two — 500 and 700. That is now a
 * rule about what we set in CSS rather than about what is in the file.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["wdth"],
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
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  // iOS ignores the manifest for `display: standalone` — these are what
  // actually get it there when someone adds the app to the home screen.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tally",
  },
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
      <body className="bg-paper text-ink flex min-h-full flex-col">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
