import { describe, expect, it } from "vitest";
import type { BrowserElementContext } from "@/lib/desktop-bridge";
import {
  describeElement,
  formatComments,
  isSecureUrl,
  type BrowserComment,
} from "./format-context";

function context(overrides: Partial<BrowserElementContext["element"]> = {}): BrowserElementContext {
  return {
    tabId: "tab-1",
    url: "http://localhost:1420/signup",
    title: "Signup",
    capturedAt: "2026-06-11T00:00:00.000Z",
    screenshotPngBase64: "png",
    element: {
      selectorCandidates: ["#email", "input.field"],
      tagName: "INPUT",
      id: "email",
      className: "field required",
      textPreview: "Email address",
      attributes: { type: "email" },
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      computedStyles: {},
      accessibility: { role: "textbox", name: "Email" },
      ...overrides,
    },
    diagnostics: { consoleErrors: [], failedNetworkRequests: [] },
  };
}

function comment(text: string, ctx = context()): BrowserComment {
  return { id: text, context: ctx, text, includeScreenshot: true };
}

describe("isSecureUrl", () => {
  it("is true only for https", () => {
    expect(isSecureUrl("https://example.com")).toBe(true);
    expect(isSecureUrl("http://localhost:1420")).toBe(false);
    expect(isSecureUrl(undefined)).toBe(false);
    expect(isSecureUrl("not a url")).toBe(false);
  });
});

describe("describeElement", () => {
  it("builds a tag#id.class label capped at two classes", () => {
    expect(describeElement(context())).toBe("input#email.field.required");
    expect(describeElement(context({ id: undefined, className: undefined }))).toBe("input");
  });
});

describe("formatComments", () => {
  it("returns empty string for no comments", () => {
    expect(formatComments([])).toBe("");
  });

  it("includes the note and the DOM anchor for a single comment", () => {
    const out = formatComments([comment("Make this required")]);
    expect(out).toContain("**Browser comment** from `http://localhost:1420/signup`");
    expect(out).toContain("### `input#email.field.required`");
    expect(out).toContain("Make this required");
    expect(out).toContain("- **Tag:** `<input>`");
    expect(out).toContain("- **Selectors:** `#email`, `input.field`");
    expect(out).toContain('- **Text:** "Email address"');
  });

  it("numbers multiple comments and falls back when a note is blank", () => {
    const out = formatComments([comment("first"), comment("")]);
    expect(out).toContain("**2 browser comments** from");
    expect(out).toContain("### Comment 1 · `input#email.field.required`");
    expect(out).toContain("### Comment 2 · `input#email.field.required`");
    expect(out).toContain("_(no comment)_");
    expect(out).toContain("\n---\n");
  });
});
