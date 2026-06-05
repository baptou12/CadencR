// Generates branded favicon + homescreen icons from the Cadencr logo.
//
// The source logo SVG is transparent; homescreen tiles look wrong on a
// transparent background (iOS composites onto black, Android crops oddly), and
// iOS ignores apple-touch-icon PNGs that carry an alpha channel. So we render
// the mark onto an opaque, full-bleed brand-dark tile, flattened (no alpha), at
// the sizes Android/Chrome and iOS expect, plus a maskable variant with extra
// padding so the mark survives circular/squircle cropping.
//
// Root-level copies (favicon.ico, apple-touch-icon*.png) matter: browsers and
// iOS auto-probe `/favicon.ico` and `/apple-touch-icon[-precomposed].png`. Our
// SPA answers unknown paths with index.html (HTML 200), which iOS treats as a
// broken icon and replaces with a generated letter tile — so these must exist
// as real image files at the web root.
//
// The generated assets are committed under public/; re-run only when the brand
// mark changes. Requires `sharp` and ImageMagick `magick` (for .ico).
// Run from packages/desktop: `node scripts/gen-pwa-icons.mjs`
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const ICONS_DIR = path.join(PUBLIC_DIR, "icons");
const LOGO_SVG = path.resolve(__dirname, "../assets/cadencr-logo3.svg");

// Brand background = theme.css default `--background` oklch(0.22 0.022 277.497).
const BG = { r: 0x18, g: 0x1a, b: 0x25 };

// Render the source logo once and trim its transparent margin, so we have a
// tight mark we can centre on the tile at a controlled size (the source SVG
// frames the mark at ~half its canvas; trimming lets us pick the padding).
const mark = await sharp(await readFile(LOGO_SVG), { density: 384 })
  .trim()
  .png()
  .toBuffer();

// Composite the mark, scaled to `markFraction` of the icon, onto an opaque
// brand tile. `flatten` drops the alpha channel so iOS accepts the icon.
// Smaller fraction = more padding; maskable needs the mark inside the safe zone.
async function tile(size, markFraction, file) {
  const markPx = Math.round(size * markFraction);
  const scaled = await sharp(mark)
    .resize(markPx, markPx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: scaled, gravity: "center" }])
    .flatten({ background: BG })
    .removeAlpha()
    .png()
    .toFile(file);
}

const ANY = 0.62; // mark ~62% of the tile
const MASKABLE = 0.52; // smaller, inside the maskable safe circle

const PNGS = [
  // Manifest icons (Android/Chrome install).
  { fraction: ANY, size: 192, file: path.join(ICONS_DIR, "icon-192.png") },
  { fraction: ANY, size: 512, file: path.join(ICONS_DIR, "icon-512.png") },
  { fraction: MASKABLE, size: 512, file: path.join(ICONS_DIR, "icon-maskable-512.png") },
  // Root-level iOS icons (explicit link + auto-probe fallbacks).
  { fraction: ANY, size: 180, file: path.join(PUBLIC_DIR, "apple-touch-icon.png") },
  { fraction: ANY, size: 180, file: path.join(PUBLIC_DIR, "apple-touch-icon-precomposed.png") },
];

await mkdir(ICONS_DIR, { recursive: true });
for (const { fraction, size, file } of PNGS) {
  await tile(size, fraction, file);
  console.log(`wrote ${path.relative(PUBLIC_DIR, file)} (${size}x${size})`);
}

// Modern browsers prefer the crisp transparent SVG favicon for tabs.
await copyFile(LOGO_SVG, path.join(PUBLIC_DIR, "favicon.svg"));
console.log("wrote favicon.svg");

// Classic favicon.ico fallback (also answers the browser's /favicon.ico probe).
const icoSrc = path.join(ICONS_DIR, "icon-512.png");
const icoOut = path.join(PUBLIC_DIR, "favicon.ico");
execFileSync("magick", [icoSrc, "-define", "icon:auto-resize=64,48,32,16", icoOut]);
console.log("wrote favicon.ico");
