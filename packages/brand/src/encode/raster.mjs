// The only module that imports sharp. Everything above it stays pure string
// building, so `src/index.mjs` is safe to import from browser and Electron code.
import sharp from "sharp";

// density 300 makes librsvg rasterize the 48-grid marks at enough internal
// resolution that the dot edges stay clean when downscaled to 16px.
const DENSITY = 300;

const dims = (size) => (typeof size === "number" ? { width: size, height: size } : size);

/** Transparent PNG at `size` (a number for squares, or `{width, height}`). */
export function png(svg, size) {
  const { width, height } = dims(size);
  return sharp(Buffer.from(svg), { density: DENSITY }).resize(width, height).png().toBuffer();
}

/**
 * Opaque flattened PNG — required for homescreen tiles, since iOS ignores
 * apple-touch-icon PNGs that carry an alpha channel.
 */
export function opaquePng(svg, size, background) {
  const { width, height } = dims(size);
  return sharp(Buffer.from(svg), { density: DENSITY })
    .resize(width, height)
    .flatten({ background })
    .removeAlpha()
    .png()
    .toBuffer();
}

/**
 * Decode a PNG to raw pixels for comparison. `--check` compares pixels rather
 * than bytes because the PNG *encoder* output is not stable across sharp /
 * libvips / zlib-ng versions or across platform prebuilds, while librsvg's
 * rasterization of a given SVG at a given size is.
 */
export async function rawPixels(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
