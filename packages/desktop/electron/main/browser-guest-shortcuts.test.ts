import { describe, expect, it } from "vitest";

import { parseBrowserGuestShortcutBindings } from "./browser-guest-shortcuts";

describe("parseBrowserGuestShortcutBindings", () => {
  it("accepts projected registry bindings and blank disabled chords", () => {
    expect(
      parseBrowserGuestShortcutBindings({
        find: { keys: ["mod", "f"] },
        zoomReset: { keys: [], altKeys: [] },
      }),
    ).toEqual({
      find: { keys: ["mod", "f"] },
      zoomReset: { keys: [], altKeys: [] },
    });
  });

  it("rejects unprojected registry metadata and chords without exactly one key", () => {
    expect(() =>
      parseBrowserGuestShortcutBindings({
        find: { id: "browser-find", keys: ["mod", "f"] },
        zoomReset: { keys: ["mod", "0"] },
      }),
    ).toThrow();
    expect(() =>
      parseBrowserGuestShortcutBindings({
        find: { keys: ["mod"] },
        zoomReset: { keys: ["mod", "0", "x"] },
      }),
    ).toThrow();
  });
});
