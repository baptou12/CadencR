import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  METHOD_NAMES,
  SUPPORTED_API_VERSIONS,
  isGuestToHost,
  isHostToGuest,
  isMethodName,
  negotiateApiVersion,
} from "./protocol.js";
import { SDK_VERSION } from "./version.js";

describe("protocol", () => {
  it("negotiates the highest common version", () => {
    expect(negotiateApiVersion([1, 3], [2, 5])).toBe(3);
    expect(negotiateApiVersion([1, 1], SUPPORTED_API_VERSIONS)).toBe(1);
    expect(negotiateApiVersion([2, 3], [1, 1])).toBeNull();
  });

  it("recognizes envelopes", () => {
    expect(isGuestToHost({ v: 1, kind: "request", id: "1", method: "hello" })).toBe(true);
    expect(isGuestToHost({ v: 2, kind: "request", id: "1", method: "hello" })).toBe(false);
    expect(isHostToGuest({ v: 1, kind: "response", id: "1", result: null })).toBe(true);
    expect(
      isHostToGuest({ v: 1, kind: "response", id: "1", error: { code: "X", message: "m" } }),
    ).toBe(true);
    expect(isHostToGuest({ v: 1, kind: "response", id: "1" })).toBe(false);
    expect(isHostToGuest({ v: 1, kind: "event", event: "theme.changed", payload: {} })).toBe(true);
    expect(isHostToGuest("nope")).toBe(false);
  });

  it("lists every method", () => {
    expect(isMethodName("api.request")).toBe(true);
    expect(isMethodName("shell.exec")).toBe(false);
    expect(new Set(METHOD_NAMES).size).toBe(METHOD_NAMES.length);
  });

  it("keeps SDK_VERSION equal to package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
