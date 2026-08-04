import type { ThemeBlend, ThemeTexture } from "./chrome";

/**
 * The Frost field, as data.
 *
 * Three big drifting halos and a film of grain over a flat cold base — the
 * texture that used to be hardcoded in `theme-frost.css` against
 * `data-theme="frost-*"`, which is why a theme duplicated from Frost arrived
 * with the palette and a blank background behind it.
 *
 * Both variants share the geometry and differ only in color and strength, so
 * the layout lives here once. A user theme is free to describe something else
 * entirely — this is the same closed vocabulary any theme file can use, not a
 * Frost-only path.
 */
interface FrostTextureOptions {
  /** Opaque field color. Also what makes `backdrop-filter` paint at all. */
  base: string;
  /** Halo colors, in drift order: the two upper fields and the lower one. */
  halos: [string, string, string];
  /** Strength of all three halos. */
  haloOpacity: number;
  grain: { color: string; opacity: number; blend: ThemeBlend };
}

/**
 * Halo positions are centres, in percent of the viewport, so the field keeps
 * its composition on any window shape. `size` is a diameter in `vw`; the drift
 * periods are deliberately co-prime-ish so the three never cycle together.
 */
const HALO_LAYOUT = [
  { size: 72, x: 28, y: 32, drift: 28 },
  { size: 66, x: 79, y: 61, drift: 36 },
  { size: 62, x: 49, y: 86, drift: 42 },
] as const;

/** Blur radius shared by every halo — the field is soft light, not shapes. */
const HALO_BLUR = 80;

/**
 * A wide, still bloom at the top of the window. The large calm areas (the agent
 * reading column) read as a lit field with depth rather than a flat slab.
 * Negligible on the bright Frost Light base, a subtle lift on Frost Dark.
 *
 * Unblurred, unlike the halos: at 140vw across, fading to transparent at 70% of
 * its own radius and carried at 5% opacity, it is already softer than any blur
 * radius would make it — and a `filter` here would cost a full-viewport
 * rasterization pass, on every window resize, for no visible difference.
 */
const TOP_GLOW = {
  color: "oklch(1 0 0)",
  size: 140,
  x: 50,
  y: 0,
  blur: 0,
  opacity: 0.05,
  drift: 0,
} as const;

/** Grain tile size, in px. */
const GRAIN_SCALE = 180;

export function frostTexture(options: FrostTextureOptions): ThemeTexture {
  return {
    base: options.base,
    halos: [
      TOP_GLOW,
      ...HALO_LAYOUT.map((layout, index) => ({
        ...layout,
        color: options.halos[index],
        blur: HALO_BLUR,
        opacity: options.haloOpacity,
      })),
    ],
    image: null,
    grain: { ...options.grain, scale: GRAIN_SCALE },
    // The halos and grain would otherwise wash out every surface above them;
    // the veil is what the translucent `body` background used to do.
    veil: true,
  };
}
