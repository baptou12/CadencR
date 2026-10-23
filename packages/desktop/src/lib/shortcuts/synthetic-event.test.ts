import { afterEach, describe, expect, it } from "vitest";
import { useShortcutOverridesStore } from "./overrides";
import { keyboardEventInitForShortcut } from "./synthetic-event";

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
