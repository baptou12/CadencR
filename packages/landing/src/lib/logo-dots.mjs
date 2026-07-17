// Index Dots ring geometry — the single source for the mark's twelve dots.
// Consumed by the themeable inline mark (LogoMark.astro) and the build-time
// raster/favicon generator (scripts/generate-icons.mjs), so the ring is
// defined once and the on-screen logo and the icons can never drift apart.
export function ringDots(count = 12, ringR = 14.5, center = 24) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI - Math.PI / 2;
    return {
      cx: +(center + ringR * Math.cos(a)).toFixed(2),
      cy: +(center + ringR * Math.sin(a)).toFixed(2),
    };
  });
}
