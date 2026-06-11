import { describe, expect, it } from "vitest";
import { domSnapshotScript, flashHighlightScript } from "./browser-dom-script";

describe("domSnapshotScript", () => {
  it("uses the document element when no selector is given", () => {
    const script = domSnapshotScript(undefined, 1000);
    expect(script).toContain("const sel = null;");
    expect(script).toContain("const max = 1000;");
    expect(script).toContain("document.documentElement");
  });

  it("embeds the selector as an inert string literal", () => {
    const script = domSnapshotScript('#a"b', 500000);
    expect(script).toContain(JSON.stringify('#a"b'));
    // The raw selector must never be spliced into executable position.
    expect(script).not.toContain("querySelector(#a");
  });

  it("scrolls to and highlights the matched element for a partial snapshot", () => {
    const script = domSnapshotScript("#root", 1000);
    expect(script).toContain("scrollIntoView");
    expect(script).toContain("root.getBoundingClientRect()");
    expect(script).toContain("document.documentElement.appendChild(box)");
  });
});

describe("flashHighlightScript", () => {
  it("draws a self-removing box at the given viewport rect", () => {
    const script = flashHighlightScript({ x: 10, y: 20, width: 30, height: 40 });
    expect(script).toContain(JSON.stringify({ x: 10, y: 20, width: 30, height: 40 }));
    expect(script).toContain("position: 'fixed'");
    expect(script).toContain("box.remove()");
  });
});
