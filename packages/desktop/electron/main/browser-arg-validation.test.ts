import { describe, expect, it } from "vitest";
import {
  optionalString,
  parseBounds,
  requiredNumber,
  requiredRecord,
  requiredString,
} from "./browser-arg-validation";

describe("browser argument validation", () => {
  it("accepts non-empty strings and finite numbers", () => {
    expect(optionalString("tab-1")).toBe("tab-1");
    expect(requiredString("url", "URL")).toBe("url");
    expect(requiredNumber(42, "x")).toBe(42);
  });

  it("rejects invalid values with parameter labels", () => {
    expect(optionalString(123)).toBeUndefined();
    expect(() => requiredString("", "URL")).toThrow("URL");
    expect(() => requiredNumber(Number.NaN, "x")).toThrow("x");
    expect(() => requiredRecord([], "args object")).toThrow("args object");
  });

  it("parses browser bounds at the IPC boundary", () => {
    expect(parseBounds({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(() => parseBounds({ x: 1, y: 2, width: "3", height: 4 })).toThrow("width");
  });
});
