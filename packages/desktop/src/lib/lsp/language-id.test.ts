import { describe, it, expect } from "vitest";
import { getLspLanguageId } from "./language-id";

describe("getLspLanguageId", () => {
  it("maps TypeScript extensions to typescript / typescriptreact", () => {
    expect(getLspLanguageId("/a/b/foo.ts")).toBe("typescript");
    expect(getLspLanguageId("/a/b/foo.tsx")).toBe("typescriptreact");
    expect(getLspLanguageId("/a/b/foo.mts")).toBe("typescript");
  });

  it("maps JavaScript extensions", () => {
    expect(getLspLanguageId("foo.js")).toBe("javascript");
    expect(getLspLanguageId("foo.jsx")).toBe("javascriptreact");
  });

  it("is case-insensitive on the extension", () => {
    expect(getLspLanguageId("Foo.TS")).toBe("typescript");
  });

  it("returns null for unsupported extensions", () => {
    expect(getLspLanguageId("README.md")).toBeNull();
    expect(getLspLanguageId("data.json")).toBeNull();
    expect(getLspLanguageId("noext")).toBeNull();
  });
});
