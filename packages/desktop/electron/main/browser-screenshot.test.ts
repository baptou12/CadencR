import { describe, expect, it } from "vitest";
import { captureScreenshotParams } from "./browser-screenshot";

describe("captureScreenshotParams", () => {
  it("builds a positive CDP clip from an element bounding box", () => {
    expect(captureScreenshotParams({ x: -10.2, y: -20.7, width: 0, height: 32.3 })).toEqual({
      format: "png",
      clip: { x: 0, y: 0, width: 1, height: 32.3, scale: 1 },
    });
  });
});
