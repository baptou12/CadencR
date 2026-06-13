import { describe, expect, it } from "vitest";
import {
  browserBounds,
  devtoolsBounds,
  sanitizeBounds,
  scaleBounds,
  windowRelativeBounds,
} from "./browser-manager-layout";

describe("browser-manager-layout", () => {
  it("converts renderer viewport bounds into native window-relative bounds", () => {
    expect(
      windowRelativeBounds({ x: 210, y: 225, width: 900, height: 700 }, { x: 90, y: 52 }),
    ).toEqual({ x: 300, y: 277, width: 900, height: 700 });
  });

  it("scales zoomed renderer bounds back to window DIP", () => {
    expect(scaleBounds({ x: 100, y: 80, width: 600, height: 400 }, 1.25)).toEqual({
      x: 125,
      y: 100,
      width: 750,
      height: 500,
    });
  });

  it("treats a non-positive zoom factor as 100%", () => {
    const bounds = { x: 10, y: 20, width: 300, height: 200 };
    expect(scaleBounds(bounds, 0)).toEqual(bounds);
  });

  it("splits browser and DevTools inside the same content well", () => {
    const bounds = sanitizeBounds({ x: 300.2, y: 277.4, width: 900.1, height: 700.8 });

    expect(browserBounds(bounds, true)).toEqual({ x: 300, y: 277, width: 900, height: 434 });
    expect(devtoolsBounds(bounds)).toEqual({ x: 300, y: 711, width: 900, height: 267 });
  });
});
