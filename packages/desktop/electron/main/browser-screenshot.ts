interface BrowserScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function captureScreenshotParams(bounds?: BrowserScreenshotBounds): Record<string, unknown> {
  if (!bounds) return { format: "png" };
  return {
    format: "png",
    clip: {
      x: Math.max(0, bounds.x),
      y: Math.max(0, bounds.y),
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      scale: 1,
    },
  };
}
