import { afterEach, describe, expect, it } from "vitest";
import type { ThemeDocument } from "@/api/generated";
import { applyThemeToDocument } from "./apply";
import { DRACULA_THEME } from "./dracula";
import { parseThemeDocument, serializeThemeDocument, withLabel } from "./draft";
import { applyThemePreview, clearThemePreview, isThemePreviewActive } from "./preview";

function document_(overrides: Partial<ThemeDocument> = {}): ThemeDocument {
  return {
    label: "Draft",
    appearance: "dark",
    cssVars: DRACULA_THEME.cssVars,
    xterm: DRACULA_THEME.xterm,
    ...overrides,
  } as ThemeDocument;
}

const root = (): HTMLElement => window.document.documentElement;
const previewStyle = (): HTMLElement | null =>
  window.document.getElementById("cadencr-theme-preview");

afterEach(() => {
  clearThemePreview();
  delete root().dataset.theme;
  delete root().dataset.appearance;
});

describe("applyThemePreview", () => {
  it("paints the draft without touching the applied theme's own rule", () => {
    root().dataset.theme = "frost-dark";
    applyThemePreview(document_());

    expect(root().dataset.theme).toBe("user:__draft__");
    expect(previewStyle()?.textContent).toContain(`:root[data-theme="user:__draft__"]`);
    expect(previewStyle()?.textContent).toContain(DRACULA_THEME.cssVars?.["--background"]);
    // The applied theme's element is the *other* one; a preview must never
    // evict it, or cancelling would leave the app unpainted.
    expect(window.document.getElementById("cadencr-theme-vars")).toBeNull();
  });

  it("follows the draft's declared appearance", () => {
    applyThemePreview(document_({ appearance: "light" }));
    expect(root().dataset.appearance).toBe("light");
  });

  it("restores the theme that was applied before the preview started", () => {
    root().dataset.theme = "frost-dark";
    root().dataset.appearance = "dark";
    applyThemePreview(document_());
    // Re-previewing on every keystroke must not re-snapshot: the second apply
    // would otherwise record the preview's own values as "previous".
    applyThemePreview(document_({ label: "Draft 2" }));
    clearThemePreview();

    expect(root().dataset.theme).toBe("frost-dark");
    expect(root().dataset.appearance).toBe("dark");
    expect(previewStyle()).toBeNull();
    expect(isThemePreviewActive()).toBe(false);
  });

  it("leaves the attributes absent when they started absent", () => {
    applyThemePreview(document_());
    clearThemePreview();
    expect(root().dataset.theme).toBeUndefined();
    expect(root().dataset.appearance).toBeUndefined();
  });

  it("is a no-op to clear when nothing was previewed", () => {
    root().dataset.theme = "frost-dark";
    clearThemePreview();
    expect(root().dataset.theme).toBe("frost-dark");
  });

  it("keeps painting when the normal apply path runs underneath it", () => {
    // Saving the theme re-applies the selection through the registry. If that
    // reclaimed `data-theme`, the preview would blank between keystrokes.
    root().dataset.theme = "frost-dark";
    applyThemePreview(document_());
    applyThemeToDocument("monokai");

    expect(root().dataset.theme).toBe("user:__draft__");
    // …and closing lands on the selection as it stands now, not the stale one.
    clearThemePreview();
    expect(root().dataset.theme).toBe("monokai");
  });
});

describe("parseThemeDocument", () => {
  const text = (overrides: Partial<ThemeDocument> = {}): string =>
    JSON.stringify(document_(overrides));

  it("accepts a complete document", () => {
    expect(parseThemeDocument(text()).label).toBe("Draft");
  });

  it("rejects a document the preview would paint wrong", () => {
    expect(() => parseThemeDocument("{ nope")).toThrow();
    expect(() => parseThemeDocument("[]")).toThrow(/must be a JSON object/);
    expect(() => parseThemeDocument(text({ label: "  " }))).toThrow(/label/);
    expect(() =>
      parseThemeDocument(text({ appearance: "sepia" as ThemeDocument["appearance"] })),
    ).toThrow(/appearance/);
  });

  it("names the first missing token rather than painting a half theme", () => {
    const { "--background": _dropped, ...rest } = DRACULA_THEME.cssVars ?? {};
    expect(() => parseThemeDocument(text({ cssVars: rest }))).toThrow(
      /cssVars` is missing --background/,
    );
  });

  it("names a missing xterm color", () => {
    const { cursor: _dropped, ...rest } = DRACULA_THEME.xterm;
    expect(() => parseThemeDocument(text({ xterm: rest as ThemeDocument["xterm"] }))).toThrow(
      /xterm` is missing cursor/,
    );
  });
});

describe("serializeThemeDocument", () => {
  it("round-trips through the on-disk shape the backend writes", () => {
    const original = document_();
    const text = serializeThemeDocument(original);
    expect(text.endsWith("\n")).toBe(true);
    expect(parseThemeDocument(text)).toEqual(original);
  });

  it("renames without disturbing anything else", () => {
    const renamed = withLabel(document_(), "New Name");
    expect(renamed.label).toBe("New Name");
    expect(renamed.cssVars).toEqual(document_().cssVars);
  });
});
