/** A single dot on the Index Dots ring, in 48-grid coordinates. */
export interface RingDot {
  cx: number;
  cy: number;
}

/** One of the mark's two cuts — dot radius and core radius on the 48 grid. */
export interface MarkCut {
  dotR: number;
  coreR: number;
}

/**
 * The mark's twelve dots, evenly spaced on a ring starting at 12 o'clock.
 * Coordinates are rounded to 2 decimals; that rounding is baked into every
 * committed brand asset.
 */
export function ringDots(count?: number, ringR?: number, center?: number): RingDot[];

export const GROUND: string;
export const INK: string;
export const EMERALD: string;
export const INK_LIGHT: string;
export const EMERALD_DEEP: string;
export const RAISED: string;
export const SOFT: string;
export const HAIRLINE: string;

/** Cut for ≥48px renderings. */
export const STANDARD_CUT: MarkCut;
/** Cut for ≤32px renderings — thicker dots, larger core. */
export const FAVICON_CUT: MarkCut;
