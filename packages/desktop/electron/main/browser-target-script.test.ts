import { describe, expect, it } from "vitest";
import { fillTargetScript, resolveTargetScript, waitForScript } from "./browser-target-script";

describe("resolveTargetScript", () => {
  it("resolves a ref from the page registry", () => {
    const script = resolveTargetScript({ ref: "e12" });
    expect(script).toContain('"ref":"e12"');
    expect(script).toContain("window.__cadencrRefs");
    expect(script).toContain("getBoundingClientRect");
    expect(script).toContain("center");
  });

  it("embeds a selector as an inert literal", () => {
    const script = resolveTargetScript({ selector: '.x"y' });
    expect(script).toContain(JSON.stringify('.x"y'));
    expect(script).not.toContain("querySelector(.x");
  });
});

describe("fillTargetScript", () => {
  it("sets the value via the native setter and dispatches events", () => {
    const script = fillTargetScript({ ref: "e3" }, "hello");
    expect(script).toContain('const value = "hello"');
    expect(script).toContain("getOwnPropertyDescriptor");
    expect(script).toContain("new Event('input'");
    expect(script).toContain("new Event('change'");
    // The filled field is flashed live.
    expect(script).toContain("document.documentElement.appendChild(box)");
  });

  it("keeps the value inert when it contains quotes", () => {
    const script = fillTargetScript({ selector: "#i" }, '");alert(1)//');
    expect(script).toContain(JSON.stringify('");alert(1)//'));
  });
});

describe("waitForScript", () => {
  it("polls for a selector or text until the timeout", () => {
    const script = waitForScript("#ready", undefined, 3000);
    expect(script).toContain(JSON.stringify("#ready"));
    expect(script).toContain("const timeout = 3000;");
    expect(script).toContain("elapsedMs");
    expect(script).toContain("setTimeout(tick, 100)");
  });
});
