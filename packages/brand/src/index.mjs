// Public API for @cadencr/brand — the geometry and tokens that application
// code needs to draw the mark inline (splash.ts, WelcomeIntro.tsx,
// LogoMark.astro).
//
// Deliberately free of any sharp import so this barrel is safe to pull into
// browser bundles and the Electron main process. The SVG builders, raster
// encoding, asset manifests, and installer are generator-side only: they live
// under src/svg, src/encode, src/targets, and scripts/install-assets.mjs, and
// are reached by deep path from Node so they never enter an app bundle.
export { ringDots } from "./geometry.mjs";
export {
  EMERALD,
  EMERALD_DEEP,
  FAVICON_CUT,
  GROUND,
  HAIRLINE,
  INK,
  INK_LIGHT,
  RAISED,
  SOFT,
  STANDARD_CUT,
} from "./tokens.mjs";
