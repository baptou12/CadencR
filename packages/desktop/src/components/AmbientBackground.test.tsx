import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmbientBackground } from "./AmbientBackground";

const PAUSED_ATTR = "data-ambient-paused";

let focused = true;

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}

function isPaused(): boolean {
  return document.documentElement.hasAttribute(PAUSED_ATTR);
}

describe("AmbientBackground", () => {
  beforeEach(() => {
    focused = true;
    setHidden(false);
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute(PAUSED_ATTR);
    vi.restoreAllMocks();
  });

  it("does not pause the halo drift while the window is visible and focused", () => {
    render(<AmbientBackground />);
    expect(isPaused()).toBe(false);
  });

  it("pauses on blur and resumes on focus", () => {
    render(<AmbientBackground />);

    focused = false;
    window.dispatchEvent(new Event("blur"));
    expect(isPaused()).toBe(true);

    focused = true;
    window.dispatchEvent(new Event("focus"));
    expect(isPaused()).toBe(false);
  });

  it("pauses when the window is hidden", () => {
    render(<AmbientBackground />);

    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isPaused()).toBe(true);
  });

  it("clears the paused state and stops reacting after unmount", () => {
    const { unmount } = render(<AmbientBackground />);

    focused = false;
    window.dispatchEvent(new Event("blur"));
    expect(isPaused()).toBe(true);

    unmount();
    expect(isPaused()).toBe(false);

    // Listeners are gone: further events must not re-add the attribute.
    window.dispatchEvent(new Event("blur"));
    expect(isPaused()).toBe(false);
  });
});
