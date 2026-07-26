import { afterEach, describe, expect, it, vi } from "vitest";
import { isMonospace } from "./isMonospace";

/** Make the next canvas 2d context return `widthFor(char)` from measureText. */
function stubCanvasContext(widthFor: (char: string) => number): void {
  const ctx = {
    font: "",
    measureText: (text: string) => ({ width: widthFor(text) }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
}

afterEach(() => vi.restoreAllMocks());

describe("isMonospace", () => {
  it("returns true when all sample glyphs measure equal", () => {
    stubCanvasContext(() => 9.6);
    expect(isMonospace("Menlo")).toBe(true);
  });

  it("returns false when glyph widths diverge", () => {
    const widths: Record<string, number> = { i: 3, W: 12, M: 11, l: 3 };
    stubCanvasContext((c) => widths[c] ?? 8);
    expect(isMonospace("Arial")).toBe(false);
  });

  it("returns false when no 2d context is available", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(isMonospace("Whatever")).toBe(false);
  });
});
