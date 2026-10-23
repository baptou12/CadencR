// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcutOverridesStore } from "./overrides";
import { dispatchShortcut, keyboardEventInitForShortcut } from "./synthetic-event";

afterEach(() => useShortcutOverridesStore.getState().resetAll());

describe("keyboardEventInitForShortcut", () => {
  it("uses Cmd on macOS and Ctrl elsewhere for the registry default", () => {
    expect(keyboardEventInitForShortcut("pane-git", true)).toEqual({
      key: "G",
      code: "KeyG",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });
    expect(keyboardEventInitForShortcut("pane-git", false)).toMatchObject({
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
    });
  });

  it("follows a user override", () => {
    useShortcutOverridesStore
      .getState()
      .setOverride("pane-terminal", { keys: ["mod", "alt", "j"] });
    expect(keyboardEventInitForShortcut("pane-terminal", false)).toMatchObject({
      key: "j",
      code: "KeyJ",
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
    });
  });

  it("refuses combos without a letter", () => {
    useShortcutOverridesStore
      .getState()
      .setOverride("pane-terminal", { keys: ["mod", "backtick"] });
    expect(keyboardEventInitForShortcut("pane-terminal", false)).toBeNull();
  });
});

describe("dispatchShortcut", () => {
  it("reaches document listeners (the form-aware engine) and window capture listeners", () => {
    const onDocument = vi.fn();
    const onWindowCapture = vi.fn();
    document.addEventListener("keydown", onDocument);
    window.addEventListener("keydown", onWindowCapture, true);
    try {
      expect(dispatchShortcut("pane-git", false)).toBe(true);
    } finally {
      document.removeEventListener("keydown", onDocument);
      window.removeEventListener("keydown", onWindowCapture, true);
    }
    expect(onDocument).toHaveBeenCalledWith(
      expect.objectContaining({ key: "G", ctrlKey: true, shiftKey: true }),
    );
    expect(onWindowCapture).toHaveBeenCalledOnce();
  });

  it("dispatches nothing for a binding it cannot synthesize", () => {
    useShortcutOverridesStore.getState().setOverride("pane-git", { keys: ["mod", "backtick"] });
    const onDocument = vi.fn();
    document.addEventListener("keydown", onDocument);
    try {
      expect(dispatchShortcut("pane-git", false)).toBe(false);
    } finally {
      document.removeEventListener("keydown", onDocument);
    }
    expect(onDocument).not.toHaveBeenCalled();
  });
});
