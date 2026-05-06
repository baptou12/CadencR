import { describe, it, expect } from "vitest";
import { getLanguageExtension } from "../language-extensions";

describe("getLanguageExtension", () => {
  const supported = [
    "file.ts",
    "file.tsx",
    "file.js",
    "file.jsx",
    "file.json",
    "file.html",
    "file.css",
    "file.rs",
    "file.md",
    "file.yaml",
    "file.yml",
    "file.py",
    "file.go",
    "file.sql",
    "file.sh",
    "file.bash",
    "file.zsh",
    "file.toml",
  ];

  for (const file of supported) {
    it(`returns a non-null extension for ${file}`, () => {
      expect(getLanguageExtension(file)).not.toBeNull();
    });
  }

  it("returns null for unknown extension", () => {
    expect(getLanguageExtension("file.xyz")).toBeNull();
    expect(getLanguageExtension("file.abc123")).toBeNull();
  });

  it("handles files with no extension", () => {
    expect(getLanguageExtension("Makefile")).toBeNull();
    expect(getLanguageExtension("Dockerfile")).toBeNull();
  });
});
