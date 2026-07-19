// SVG builders for the Index Dots mark, in every shape the repo needs.
// All builders return markup WITHOUT a trailing newline; assets.mjs adds the
// generated-by header and the trailing newline for assets written as text.
import { ringDots } from "../geometry.mjs";
import {
  EMERALD,
  EMERALD_DEEP,
  FAVICON_CUT,
  GROUND,
  INK,
  INK_LIGHT,
  STANDARD_CUT,
} from "../tokens.mjs";

function dotCircles(dotR) {
  return ringDots()
    .map((d) => `<circle cx="${d.cx}" cy="${d.cy}" r="${dotR}"/>`)
    .join("");
}

/**
 * The mark itself — dots plus core, no ground. Every builder below wraps this,
 * so a change to the mark's anatomy is one edit rather than four. `indent` is
 * the leading whitespace of the line the caller places it on.
 */
export function markBody({ dotR, coreR }, dots, core, indent = "  ") {
  return `<g fill="${dots}">${dotCircles(dotR)}</g>\n${indent}<circle cx="24" cy="24" r="${coreR}" fill="${core}"/>`;
}

/** Transparent 48-grid mark — the in-app logo asset. */
export function markSvg(cut, dots, core) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  ${markBody(cut, dots, core)}
</svg>`;
}

/** Full-bleed graphite tile — PWA / touch icons (rasterized opaque). */
export function tileSvg(cut, markScale = 1) {
  // Only wrap in a scaling group when there is something to scale — the
  // unscaled tile is committed as text (landing's favicon.svg).
  const open =
    markScale === 1
      ? ""
      : `<g transform="translate(24 24) scale(${markScale}) translate(-24 -24)">`;
  const close = markScale === 1 ? "" : "</g>";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="${GROUND}"/>
  ${open}${markBody(cut, INK, EMERALD)}${close}
</svg>`;
}

/**
 * macOS-template squircle tile (1024 grid, transparent corners) — the Electron
 * app icon. The mark spans ~560px of the 824px tile, matching the optical
 * density of the full-bleed icons (mark bbox ≈ 68% of its ground).
 */
export function appIconSvg(cut, markScale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" ry="185" fill="${GROUND}"/>
  <g transform="translate(512 512) scale(${markScale}) translate(-24 -24)">
    ${markBody(cut, INK, EMERALD, "    ")}
  </g>
</svg>`;
}

/**
 * Tab favicon: transparent, and adapts dots/core to the tab bar's color scheme
 * (ink on dark, graphite on light) rather than baking one ground.
 */
export function adaptiveFaviconSvg({ dotR, coreR }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <style>
    .dots { fill: ${INK_LIGHT}; } .core { fill: ${EMERALD_DEEP}; }
    @media (prefers-color-scheme: dark) {
      .dots { fill: ${INK}; } .core { fill: ${EMERALD}; }
    }
  </style>
  <g class="dots">${dotCircles(dotR)}</g>
  <circle class="core" cx="24" cy="24" r="${coreR}"/>
</svg>`;
}

// The two tile cuts, shared by the desktop and landing manifests so both sites
// provably ship the same favicon artwork rather than two lookalike thunks.
export const tileStandard = () => tileSvg(STANDARD_CUT);
export const tileFavicon = () => tileSvg(FAVICON_CUT);

/** The favicon.ico size ladder — identical for desktop and landing. */
export const faviconIcoEntries = () => [
  { size: 16, svg: tileFavicon },
  { size: 32, svg: tileFavicon },
  { size: 48, svg: tileStandard },
];
