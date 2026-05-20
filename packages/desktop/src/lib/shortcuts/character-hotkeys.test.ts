import { describe, expect, it } from "vitest";
import { expandCharacterHotkey } from "./character-hotkeys";

describe("expandCharacterHotkey", () => {
  it("expands Mod+Plus for QWERTY and AZERTY plus characters", () => {
    expect(expandCharacterHotkey("Mod+Plus")).toEqual([
      { hotkey: "Mod+=", exactKeys: ["+"] },
      { hotkey: "Mod+Shift+=", exactKeys: ["+", "="] },
      { hotkey: "Mod+/", exactKeys: ["+"] },
      { hotkey: "Mod+Shift+/", exactKeys: ["+"] },
    ]);
  });

  it("does not add a shifted underscore variant for Mod+Minus", () => {
    expect(expandCharacterHotkey("Mod+-")).toEqual([{ hotkey: "Mod+-", exactKeys: ["-"] }]);
  });
});
