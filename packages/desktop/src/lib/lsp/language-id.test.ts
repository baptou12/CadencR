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

  it("uses an explicit editor language override", () => {
    expect(getLspLanguageId("schema.data", "json")).toBe("json");
    expect(getLspLanguageId("script.ts", "markdown")).toBeNull();
  });

  it("returns null for env files so we don't try to spawn an LSP", () => {
    // Env files get shell syntax highlighting (see language-extensions),
    // but they're not shell programs — LSPs reject or fail on them, and
    // spawning a server just to tear it down surfaces a "Language server
    // failed" error to the user. The right answer is no LSP at all.
    expect(getLspLanguageId(".env")).toBeNull();
    expect(getLspLanguageId(".env.local")).toBeNull();
    expect(getLspLanguageId(".env.production.local")).toBeNull();
    expect(getLspLanguageId("local.env")).toBeNull();
    expect(getLspLanguageId("development.env")).toBeNull();
    expect(getLspLanguageId("API.ENV")).toBeNull();
  });

  it("does not match env-looking but unrelated files", () => {
    expect(getLspLanguageId("env")).toBeNull();
    expect(getLspLanguageId("env.txt")).toBeNull();
    expect(getLspLanguageId("envvars.json")).toBe("json");
  });
});
