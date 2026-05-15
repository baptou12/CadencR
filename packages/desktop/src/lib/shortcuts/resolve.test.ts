import { describe, expect, it, vi } from "vitest";

// Stub the platform check so we can exercise both branches in one process.
// `resolve.ts` reads `PLATFORM_IS_MAC` at module load, so the mock has to be
// declared before the import.
const platformMock = vi.hoisted(() => ({ isMac: true }));
vi.mock("./format", () => ({
  get PLATFORM_IS_MAC() {
    return platformMock.isMac;
  },
}));

async function importResolve() {
  vi.resetModules();
  return await import("./resolve");
}

describe("tokensToHotkeyString (mac)", () => {
  it('translates "mod" to "meta"', async () => {
    platformMock.isMac = true;
    const { tokensToHotkeyString } = await importResolve();
    expect(tokensToHotkeyString(["mod", "k"])).toBe("meta+k");
  });

  it('translates "plus" to "=" so ⌘+ works without shift', async () => {
    platformMock.isMac = true;
    const { tokensToHotkeyString } = await importResolve();
    expect(tokensToHotkeyString(["mod", "plus"])).toBe("meta+=");
  });

  it("emits literal punctuation that both engines parse identically", async () => {
    platformMock.isMac = true;
    const { tokensToHotkeyString } = await importResolve();
    expect(tokensToHotkeyString(["mod", "shift", "rbracket"])).toBe("meta+shift+]");
    expect(tokensToHotkeyString(["mod", "slash"])).toBe("meta+/");
    expect(tokensToHotkeyString(["mod", "comma"])).toBe("meta+,");
    expect(tokensToHotkeyString(["mod", "alt", "left"])).toBe("meta+alt+left");
    expect(tokensToHotkeyString(["shift", "tab"])).toBe("shift+tab");
  });

  it("passes letters and digits through, lowercased", async () => {
    platformMock.isMac = true;
    const { tokensToHotkeyString } = await importResolve();
    expect(tokensToHotkeyString(["mod", "shift", "N"])).toBe("meta+shift+n");
    expect(tokensToHotkeyString(["mod", "0"])).toBe("meta+0");
  });
});

describe("tokensToHotkeyString (non-mac)", () => {
  it('translates "mod" to "ctrl" — fixes the latent meta-only bug', async () => {
    platformMock.isMac = false;
    const { tokensToHotkeyString } = await importResolve();
    expect(tokensToHotkeyString(["mod", "b"])).toBe("ctrl+b");
  });

  it('leaves literal "ctrl" alone (vim chords are ctrl on every platform)', async () => {
    platformMock.isMac = false;
    const { tokensToHotkeyString } = await importResolve();
    expect(tokensToHotkeyString(["ctrl", "j"])).toBe("ctrl+j");
  });
});

describe("resolveHotkeyTrigger", () => {
  it("returns a plain string when there are no altKeys", async () => {
    platformMock.isMac = true;
    const { resolveHotkeyTrigger } = await importResolve();
    expect(resolveHotkeyTrigger({ keys: ["mod", "k"] })).toBe("meta+k");
  });

  it("returns [primary, alt] when altKeys is set — both bound to the same action", async () => {
    platformMock.isMac = true;
    const { resolveHotkeyTrigger } = await importResolve();
    expect(resolveHotkeyTrigger({ keys: ["mod", "shift", "p"], altKeys: ["alt", "p"] })).toEqual([
      "meta+shift+p",
      "alt+p",
    ]);
  });
});

describe("getRegistryShortcut", () => {
  it("returns the registry entry for a known id", async () => {
    platformMock.isMac = true;
    const { getRegistryShortcut } = await importResolve();
    expect(getRegistryShortcut("command-palette")).toMatchObject({
      id: "command-palette",
      keys: ["mod", "k"],
      scope: "global",
    });
  });
});
