import { describe, it, expect } from "vitest";
import { resolvePreviewImagePath } from "./PreviewMarkdownImage";

describe("resolvePreviewImagePath", () => {
  it("resolves a path relative to the file's directory", () => {
    expect(resolvePreviewImagePath("docs", "assets/logo.png")).toBe("docs/assets/logo.png");
  });

  it("treats a root README's directory as the project root", () => {
    expect(resolvePreviewImagePath("", "packages/landing/hero.png")).toBe(
      "packages/landing/hero.png",
    );
  });

  it("normalizes ./ and ../ segments", () => {
    expect(resolvePreviewImagePath("docs/guide", "./img/a.png")).toBe("docs/guide/img/a.png");
    expect(resolvePreviewImagePath("docs/guide", "../img/a.png")).toBe("docs/img/a.png");
    expect(resolvePreviewImagePath("a/b/c", "../../x.png")).toBe("a/x.png");
  });

  it("treats a leading slash as repo-root-relative", () => {
    expect(resolvePreviewImagePath("docs/guide", "/assets/a.png")).toBe("assets/a.png");
  });

  it("strips query and hash suffixes", () => {
    expect(resolvePreviewImagePath("docs", "a.png?v=2#frag")).toBe("docs/a.png");
  });

  it("returns null for remote and inline URLs", () => {
    expect(resolvePreviewImagePath("docs", "https://example.com/a.png")).toBeNull();
    expect(resolvePreviewImagePath("docs", "http://example.com/a.png")).toBeNull();
    expect(resolvePreviewImagePath("docs", "data:image/png;base64,AAAA")).toBeNull();
    expect(resolvePreviewImagePath("docs", "//cdn.example.com/a.png")).toBeNull();
  });

  it("returns null for an empty src", () => {
    expect(resolvePreviewImagePath("docs", "")).toBeNull();
  });
});
