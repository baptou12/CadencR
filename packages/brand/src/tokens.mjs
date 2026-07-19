// Emerald Reserve brand tokens (root DESIGN.md "Brand identity").
// The single source for every generated brand asset in the repo — the two
// icon generators these replaced each kept their own copy of these values.

/** Graphite ground behind baked/full-bleed marks. */
export const GROUND = "#131416";
/** Dot color on dark grounds. */
export const INK = "#eff0f2";
/** Core color on dark grounds. */
export const EMERALD = "#2db47d";
/** Dot color on light grounds (in-app light themes, adaptive favicon). */
export const INK_LIGHT = "#222429";
/** Core color on light grounds. */
export const EMERALD_DEEP = "#087653";

// Chrome around the mark — the social card's raised panel and muted tagline,
// and the splash window's surfaces and hairline borders.
export const RAISED = "#1a1b1d";
export const SOFT = "#a7a9ad";
export const HAIRLINE = "#34373a";

/**
 * The mark has exactly two cuts. Below ~32px the standard dots disappear into
 * the grid, so small sizes get thicker dots and a larger core.
 */
export const STANDARD_CUT = { dotR: 1.9, coreR: 5.5 };
export const FAVICON_CUT = { dotR: 3, coreR: 7 };
