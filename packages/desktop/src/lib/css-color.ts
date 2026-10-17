export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/**
 * Any CSS color (`oklch()`, named, translucent…) resolved to opaque RGB by
 * painting it on a 1×1 canvas — over `base` first when given, so a
 * translucent color is composited onto it. `null` where no canvas exists:
 * the caller keeps the raw value.
 */
export function cssColorToRgb(value: string, base?: string): RgbColor | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    if (base !== undefined) {
      context.fillStyle = base;
      context.fillRect(0, 0, 1, 1);
    }
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
    return { red, green, blue };
  } catch {
    // DOM shims without a canvas implementation throw: no color to resolve.
    return null;
  }
}
