import { describe, expect, it } from "vitest";
import { domOutlineScript } from "./browser-outline-script";

describe("domOutlineScript", () => {
  it("walks the body and registers refs on the page window", () => {
    const script = domOutlineScript(undefined, 40000);
    expect(script).toContain("const sel = null;");
    expect(script).toContain("document.body");
    expect(script).toContain("window.__cadencrRefs = refs");
    expect(script).toContain("'e' + (refs.size + 1)");
  });

  it("embeds the selector as an inert literal and highlights the subtree", () => {
    const script = domOutlineScript('#a"b', 1000);
    expect(script).toContain(JSON.stringify('#a"b'));
    expect(script).not.toContain("querySelector(#a");
    expect(script).toContain("scrollIntoView");
    expect(script).toContain("root.getBoundingClientRect()");
  });
});
