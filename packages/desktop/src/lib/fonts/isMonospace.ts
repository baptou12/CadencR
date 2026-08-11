const SAMPLE_CHARS = ["i", "W", "M", "l"] as const;
const WIDTH_TOLERANCE_PX = 0.5;
let canvasContext: CanvasRenderingContext2D | undefined;

function monospaceCanvasContext(): CanvasRenderingContext2D | null {
  const context = canvasContext ?? document.createElement("canvas").getContext("2d");
  if (context) canvasContext = context;
  return context;
}

/**
 * Heuristic: a font is monospace when its glyphs share one advance width.
 * Measures a few discriminating characters on a canvas at a fixed size and
 * treats the family as fixed-width when their widths agree within tolerance.
 * Returns false when no 2d context is available (e.g. jsdom).
 */
export function isMonospace(family: string): boolean {
  const ctx = monospaceCanvasContext();
  if (!ctx) return false;
  ctx.font = `16px "${family}"`;
  const widths = SAMPLE_CHARS.map((c) => ctx.measureText(c).width);
  return Math.max(...widths) - Math.min(...widths) < WIDTH_TOLERANCE_PX;
}
