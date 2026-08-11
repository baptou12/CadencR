import { afterEach, describe, expect, it, vi } from "vitest";

/** Make the next canvas 2d context return `widthFor(char)` from measureText. */
function stubCanvasContext(widthFor: (char: string) => number): void {
  const ctx = {
    font: "",
    measureText: (text: string) => ({ width: widthFor(text) }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
}

async function loadIsMonospace(): Promise<(family: string) => boolean> {
  const { isMonospace } = await import("./isMonospace");
  return isMonospace;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("isMonospace", () => {
  it("returns true when all sample glyphs measure equal", async () => {
    stubCanvasContext(() => 9.6);
    const isMonospace = await loadIsMonospace();
    expect(isMonospace("Menlo")).toBe(true);
  });

  it("returns false when glyph widths diverge", async () => {
    const widths: Record<string, number> = { i: 3, W: 12, M: 11, l: 3 };
    stubCanvasContext((c) => widths[c] ?? 8);
    const isMonospace = await loadIsMonospace();
    expect(isMonospace("Arial")).toBe(false);
  });

  it("returns false when no 2d context is available", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const isMonospace = await loadIsMonospace();
    expect(isMonospace("Whatever")).toBe(false);
  });

  it("retries canvas acquisition after a transient failure", async () => {
    const context = {
      font: "",
      measureText: () => ({ width: 9.6 }),
    } as unknown as CanvasRenderingContext2D;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValueOnce(null)
      .mockReturnValue(context);
    const isMonospace = await loadIsMonospace();
    const callsBeforeChecks = getContext.mock.calls.length;

    expect(isMonospace("Menlo")).toBe(false);
    expect(isMonospace("Menlo")).toBe(true);
    expect(getContext.mock.calls.length - callsBeforeChecks).toBe(2);
  });

  it("reuses one canvas context across font checks", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: () => ({ width: 9.6 }),
    } as unknown as CanvasRenderingContext2D);
    const isMonospace = await loadIsMonospace();
    const callsBeforeChecks = getContext.mock.calls.length;

    expect(isMonospace("Menlo")).toBe(true);
    expect(isMonospace("Monaco")).toBe(true);
    expect(getContext.mock.calls.length - callsBeforeChecks).toBe(1);
  });
});
