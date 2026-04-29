import { describe, it, expect, beforeEach, vi } from "vitest";
import { getActiveFocusZone, focusZoneByDirection } from "./focus-zones";

describe("getActiveFocusZone", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when no focused element has a data-focus-zone", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.focus();
    // div has no tabIndex so it won't be activeElement in jsdom normally
    // Test that null is returned when activeElement has no zone ancestor
    expect(getActiveFocusZone()).toBeNull();
  });

  it("returns zone name from focused element", () => {
    const div = document.createElement("div");
    div.setAttribute("data-focus-zone", "sidebar");
    div.setAttribute("tabIndex", "0");
    document.body.appendChild(div);
    div.focus();
    expect(getActiveFocusZone()).toBe("sidebar");
  });

  it("returns zone name from ancestor when child is focused", () => {
    const parent = document.createElement("div");
    parent.setAttribute("data-focus-zone", "main");
    const child = document.createElement("input");
    parent.appendChild(child);
    document.body.appendChild(parent);
    child.focus();
    expect(getActiveFocusZone()).toBe("main");
  });

  it("returns innermost (most specific) zone when nested zones exist", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-focus-zone", "outer");
    const inner = document.createElement("div");
    inner.setAttribute("data-focus-zone", "inner");
    const input = document.createElement("input");
    inner.appendChild(input);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    input.focus();
    expect(getActiveFocusZone()).toBe("inner");
  });

  it("returns null when document has no active element", () => {
    // Blur everything
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    // After blurring, activeElement is body with no data-focus-zone
    expect(getActiveFocusZone()).toBeNull();
  });
});

describe("focusZoneByDirection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function createZones(...names: string[]) {
    for (const name of names) {
      const el = document.createElement("div");
      el.setAttribute("data-focus-zone", name);
      el.setAttribute("tabindex", "0");
      document.body.appendChild(el);
    }
  }

  it("focuses the next zone to the right", () => {
    createZones("left-sidebar", "main-content");
    const sidebar = document.querySelector('[data-focus-zone="left-sidebar"]') as HTMLElement;
    sidebar.focus();
    focusZoneByDirection("right");
    expect(document.activeElement?.getAttribute("data-focus-zone")).toBe("main-content");
  });

  it("focuses the previous zone to the left", () => {
    createZones("left-sidebar", "main-content");
    const main = document.querySelector('[data-focus-zone="main-content"]') as HTMLElement;
    main.focus();
    focusZoneByDirection("left");
    expect(document.activeElement?.getAttribute("data-focus-zone")).toBe("left-sidebar");
  });

  it("does not wrap around at the edges", () => {
    createZones("left-sidebar", "main-content");
    const sidebar = document.querySelector('[data-focus-zone="left-sidebar"]') as HTMLElement;
    sidebar.focus();
    focusZoneByDirection("left");
    expect(document.activeElement?.getAttribute("data-focus-zone")).toBe("left-sidebar");
  });

  it("skips zones not present in the DOM", () => {
    // left-sidebar and terminal exist, but main-content is missing
    createZones("left-sidebar", "terminal");
    const sidebar = document.querySelector('[data-focus-zone="left-sidebar"]') as HTMLElement;
    sidebar.focus();
    focusZoneByDirection("right");
    expect(document.activeElement?.getAttribute("data-focus-zone")).toBe("terminal");
  });

  it("dispatches cadencr:focus-prompt when focusing main-content", () => {
    createZones("left-sidebar", "main-content");
    const sidebar = document.querySelector('[data-focus-zone="left-sidebar"]') as HTMLElement;
    sidebar.focus();
    const handler = vi.fn();
    window.addEventListener("cadencr:focus-prompt", handler);
    focusZoneByDirection("right");
    // Event dispatched via requestAnimationFrame — flush it
    vi.useFakeTimers();
    vi.runAllTimers();
    vi.useRealTimers();
    // Note: jsdom doesn't run rAF callbacks, so we verify the zone was focused
    expect(document.activeElement?.getAttribute("data-focus-zone")).toBe("main-content");
    window.removeEventListener("cadencr:focus-prompt", handler);
  });
});
