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

  it("maps config and web document extensions", () => {
    expect(getLspLanguageId("package.json")).toBe("json");
    expect(getLspLanguageId("tsconfig.jsonc")).toBe("jsonc");
    expect(getLspLanguageId(".github/workflows/ci.yml")).toBe("yaml");
    expect(getLspLanguageId("index.html")).toBe("html");
    expect(getLspLanguageId("style.css")).toBe("css");
    expect(getLspLanguageId("style.scss")).toBe("scss");
    expect(getLspLanguageId("style.less")).toBe("less");
  });

  it("maps framework single-file component extensions", () => {
    expect(getLspLanguageId("App.svelte")).toBe("svelte");
    expect(getLspLanguageId("App.vue")).toBe("vue");
    expect(getLspLanguageId("Page.astro")).toBe("astro");
  });

  it("maps shell and Dockerfile names", () => {
    expect(getLspLanguageId("script.sh")).toBe("shellscript");
    expect(getLspLanguageId("script.bash")).toBe("shellscript");
    expect(getLspLanguageId("script.zsh")).toBe("shellscript");
    expect(getLspLanguageId("Dockerfile")).toBe("dockerfile");
    expect(getLspLanguageId("api.Dockerfile")).toBe("dockerfile");
    expect(getLspLanguageId("Dockerfile.prod")).toBe("dockerfile");
  });

  it("is case-insensitive on the extension", () => {
    expect(getLspLanguageId("Foo.TS")).toBe("typescript");
    expect(getLspLanguageId("Dockerfile.PROD")).toBe("dockerfile");
  });

  it("returns null for unsupported extensions", () => {
    expect(getLspLanguageId("README.md")).toBeNull();
    expect(getLspLanguageId("noext")).toBeNull();
  });
});
