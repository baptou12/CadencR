import { describe, expect, it } from "vitest";
import {
  emptyEditorLanguageOverrides,
  getLanguageOverrideExtension,
  getLanguagePickerSelection,
  parseEditorLanguageOverrides,
  resolveEditorLanguageId,
  updateEditorLanguageOverrides,
} from "./editor-language-overrides";

describe("editor language overrides", () => {
  it("updates only the selected file when the extension checkbox is off", () => {
    const overrides = updateEditorLanguageOverrides(
      emptyEditorLanguageOverrides(),
      "src/schema.data",
      { preference: "json", applyToExtension: false },
    );
    expect(resolveEditorLanguageId("src/schema.data", overrides)).toBe("json");
    expect(resolveEditorLanguageId("src/other.data", overrides)).toBe("plaintext");
  });

  it("prefers a file override over an extension override", () => {
    const overrides = {
      version: 1 as const,
      files: { "src/schema.data": "json" as const },
      extensions: { data: "yaml" as const },
    };
    expect(resolveEditorLanguageId("src/schema.data", overrides)).toBe("json");
    expect(resolveEditorLanguageId("src/other.data", overrides)).toBe("yaml");
  });

  it("removes a file override when Automatic is selected", () => {
    const overrides = updateEditorLanguageOverrides(
      {
        version: 1,
        files: { "src/file.ts": "rust" },
        extensions: { ts: "python" },
      },
      "src/file.ts",
      { preference: "auto", applyToExtension: false },
    );
    expect(overrides.files).toEqual({});
    expect(resolveEditorLanguageId("src/file.ts", overrides)).toBe("python");
  });

  it("updates all matching extensions and clears the current file exception", () => {
    const overrides = updateEditorLanguageOverrides(
      {
        version: 1,
        files: { "src/file.foo": "rust" },
        extensions: {},
      },
      "src/file.foo",
      { preference: "json", applyToExtension: true },
    );

    expect(overrides).toEqual({ version: 1, files: {}, extensions: { foo: "json" } });
    expect(getLanguagePickerSelection("src/another.foo", overrides)).toEqual({
      preference: "json",
      applyToExtension: true,
    });
  });

  it("removes an extension rule when Automatic is applied to the extension", () => {
    const overrides = updateEditorLanguageOverrides(
      { version: 1, files: {}, extensions: { foo: "json" } },
      "src/file.foo",
      { preference: "auto", applyToExtension: true },
    );
    expect(overrides.extensions).toEqual({});
  });

  it("extracts the literal final extension used by the checkbox", () => {
    expect(getLanguageOverrideExtension("FILE.TS")).toBe("ts");
    expect(getLanguageOverrideExtension(".env")).toBe("env");
    expect(getLanguageOverrideExtension("Makefile")).toBeNull();
  });

  it("treats override maps as own-key dictionaries", () => {
    const empty = emptyEditorLanguageOverrides();
    expect(resolveEditorLanguageId("src/file.constructor", empty)).toBe("plaintext");

    const overrides = updateEditorLanguageOverrides(empty, "src/file.constructor", {
      preference: "json",
      applyToExtension: true,
    });
    expect(resolveEditorLanguageId("src/other.constructor", overrides)).toBe("json");
  });

  it("round-trips the persisted format and rejects corrupt values", () => {
    const overrides = { version: 1 as const, files: { "a.ts": "python" as const }, extensions: {} };
    expect(parseEditorLanguageOverrides(JSON.stringify(overrides))).toEqual(overrides);
    expect(parseEditorLanguageOverrides(null)).toEqual(emptyEditorLanguageOverrides());
    expect(() => parseEditorLanguageOverrides("not-json")).toThrow(/not valid JSON/);
    expect(() =>
      parseEditorLanguageOverrides(
        JSON.stringify({ version: 1, files: { "a.ts": "unknown" }, extensions: {} }),
      ),
    ).toThrow(/Invalid language override/);
  });
});
