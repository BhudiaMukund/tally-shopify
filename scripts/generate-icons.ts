import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/**
 * One-off: rasterises the PWA icons from an inline SVG mark rather than a
 * designed asset — there isn't one in the repo yet (BUILD_PLAN §10 needs
 * installability, not a logo). A geometric "T" built from two rects, not
 * text: font rendering in `sharp`/librsvg depends on what's installed on the
 * machine that runs this, and a monogram that only works on the machine that
 * generated it defeats the point of committing the PNGs. Re-run this script
 * by hand if the mark ever needs to change — the output is what ships, not
 * this file.
 */

const OUT_DIR = path.join(process.cwd(), "public", "icons");

const INK = "#14181F";
const PAPER = "#EEF1F5";

/** A "T" as two rects — bar and stem share a top edge, avoiding any font dependency. */
function markSvg(background: string, foreground: string): string {
  return `
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="96" fill="${background}" />
      <rect x="136" y="176" width="240" height="52" rx="12" fill="${foreground}" />
      <rect x="232" y="176" width="48" height="216" rx="12" fill="${foreground}" />
    </svg>
  `;
}

interface IconSpec {
  file: string;
  size: number;
  svg: string;
}

const specs: IconSpec[] = [
  { file: "icon-192.png", size: 192, svg: markSvg(INK, PAPER) },
  { file: "icon-512.png", size: 512, svg: markSvg(INK, PAPER) },
  // Maskable icons get cropped to a circle/squircle by the OS — the mark
  // already sits well inside the safe zone at this padding, so the same
  // source works for both purposes.
  { file: "icon-512-maskable.png", size: 512, svg: markSvg(INK, PAPER) },
];

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  for (const spec of specs) {
    const png = await sharp(Buffer.from(spec.svg)).resize(spec.size, spec.size).png().toBuffer();
    await writeFile(path.join(OUT_DIR, spec.file), png);
    console.log(`wrote public/icons/${spec.file}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
