// Index Dots ring geometry — the single source for the mark's twelve dots.
// Consumed by the inline marks (LogoMark.astro, splash.ts, WelcomeIntro.tsx)
// and by every generated raster/vector asset, so the on-screen logo and the
// icons can never drift apart.
//
// The 2-decimal rounding is load-bearing: it is baked into every committed
// SVG and PNG in the repo. Changing it rewrites every brand asset.
export function ringDots(count = 12, ringR = 14.5, center = 24) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI - Math.PI / 2;
    return {
      cx: +(center + ringR * Math.cos(a)).toFixed(2),
      cy: +(center + ringR * Math.sin(a)).toFixed(2),
    };
  });
}
