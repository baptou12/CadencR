// The 1280x640 social card, shared by the landing OG image and the GitHub
// repo social preview: a graphite ground with a soft bloom, the mark seated in
// a raised squircle tile, and the wordmark + tagline stacked to its right.
//
// All text is outlined (see wordmark.mjs) — librsvg ignores @font-face, so
// <text> here would render in a host fallback font and differ per machine.
import { markBody } from "./mark.mjs";
import { outlinedText, outlinedWidth, TAGLINE, WORDMARK } from "./wordmark.mjs";
import { EMERALD, GROUND, INK, RAISED, SOFT, STANDARD_CUT } from "../tokens.mjs";

const WIDTH = 1280;
const HEIGHT = 640;

const TILE = 156;
const TILE_RADIUS = 40;
const GAP = 44; // tile → text
const WORDMARK_CAP = 55;
const TAGLINE_CAP = 20;
const BASELINE_GAP = 48; // wordmark baseline → tagline baseline

// The mark's ring spans ~70% of the tile, matching the app icon's density.
const MARK_SCALE = (TILE * 0.7) / 48;

// Composed coordinates are rounded like ringDots': unrounded arithmetic here
// bakes float noise (translate(356.92999999999995 265.4)) into a committed asset.
const round = (n) => Number(n.toFixed(2));

/** The mark, drawn at `scale` with its top-left at (x, y). */
function markAt(x, y, scale) {
  return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})">
      ${markBody(STANDARD_CUT, INK, EMERALD, "      ")}
    </g>`;
}

export function socialSvg() {
  const textWidth = Math.max(
    outlinedWidth(WORDMARK, WORDMARK_CAP),
    outlinedWidth(TAGLINE, TAGLINE_CAP),
  );
  // Center the whole lockup rather than seating it left of center, so the card
  // survives the aspect-ratio crops different platforms apply.
  const lockupWidth = TILE + GAP + textWidth;
  const left = (WIDTH - lockupWidth) / 2;
  const midY = HEIGHT / 2;

  const tileX = round(left);
  const tileY = round(midY - TILE / 2);
  const markSize = 48 * MARK_SCALE;
  const markX = tileX + (TILE - markSize) / 2;
  const markY = tileY + (TILE - markSize) / 2;

  const textX = round(left + TILE + GAP);
  // Stack the two baselines so the text block's optical center sits on midY.
  const wordmarkBaseline = round(midY - (BASELINE_GAP - WORDMARK_CAP) / 2);
  const taglineBaseline = round(wordmarkBaseline + BASELINE_GAP);

  // No glow or bloom behind the tile: librsvg posterizes a wide low-contrast
  // radial gradient into visible rings, and approximates feGaussianBlur with
  // box blurs that leave a boxy halo. Space and the raised surface carry it,
  // which is what DESIGN.md's "space, not lines" rule asks for anyway.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${GROUND}"/>
  <rect x="${tileX}" y="${tileY}" width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}" ry="${TILE_RADIUS}" fill="${RAISED}"/>
  ${markAt(markX, markY, MARK_SCALE)}
  ${outlinedText({ glyphs: WORDMARK, x: textX, y: wordmarkBaseline, height: WORDMARK_CAP, fill: INK })}
  ${outlinedText({ glyphs: TAGLINE, x: textX, y: taglineBaseline, height: TAGLINE_CAP, fill: SOFT })}
</svg>`;
}
