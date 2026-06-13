import { describe, expect, it } from "vitest";
import {
  assertBrowserMutationAllowed,
  consoleLevelName,
  externalAutomationMatches,
  isElementPayload,
  metadataFor,
  pushBounded,
} from "./browser-manager-utils";

describe("browser-manager-utils", () => {
  it("keeps bounded diagnostic buffers at their limit", () => {
    const values = [1, 2, 3];
    pushBounded(values, 4, 3);
    expect(values).toEqual([2, 3, 4]);
  });

  it("maps Electron console levels to stable names", () => {
    expect(consoleLevelName(0)).toBe("verbose");
    expect(consoleLevelName(3)).toBe("error");
    expect(consoleLevelName(99)).toBe("info");
    // Electron 42 reports levels as strings.
    expect(consoleLevelName("warning")).toBe("warning");
    expect(consoleLevelName("error")).toBe("error");
    expect(consoleLevelName("debug")).toBe("verbose");
  });

  it("validates element-context payload shape", () => {
    expect(
      isElementPayload({
        selectorCandidates: ["#a"],
        tagName: "BUTTON",
        attributes: {},
        boundingBox: {},
        computedStyles: {},
      }),
    ).toBe(true);
    expect(
      isElementPayload({
        selectorCandidates: [],
        attributes: {},
        boundingBox: {},
        computedStyles: {},
      }),
    ).toBe(false);
  });

  it("requires live localhost URLs before browser mutation", () => {
    expect(() => assertBrowserMutationAllowed("http://localhost:5173/signup")).not.toThrow();
    expect(() => assertBrowserMutationAllowed("https://example.com/")).toThrow("localhost");
  });

  it("scopes external automation unlock to the approved origin", () => {
    const origin = "https://example.com";
    // Same origin (any path) stays unlocked.
    expect(externalAutomationMatches("https://example.com/dashboard", origin)).toBe(true);
    // Navigating to a different origin re-locks.
    expect(externalAutomationMatches("https://evil.test/", origin)).toBe(false);
    expect(externalAutomationMatches("http://example.com/", origin)).toBe(false);
    // Never unlocked when no origin was approved, or for unparseable URLs.
    expect(externalAutomationMatches("https://example.com/", null)).toBe(false);
    expect(externalAutomationMatches("about:blank", origin)).toBe(false);
  });

  it("builds default metadata for new tabs", () => {
    expect(metadataFor("tab-1", "fresh")).toMatchObject({
      id: "tab-1",
      url: "about:blank",
      devToolsOpen: false,
    });
  });
});
