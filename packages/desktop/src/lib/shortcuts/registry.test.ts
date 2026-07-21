import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "./registry";

function shortcutKeys(id: string): string[] {
  const shortcut = SHORTCUTS.find((entry) => entry.id === id);
  if (!shortcut) throw new Error(`Shortcut not found: ${id}`);
  return shortcut.keys;
}

describe("shortcut registry", () => {
  it("keeps unified-agent open-feature on mod+shift+o so Git can use mod+o", () => {
    expect(shortcutKeys("agents-open-feature")).toEqual(["mod", "shift", "o"]);
    expect(shortcutKeys("git-open-in-editor")).toEqual(["mod", "o"]);
  });

  it("registers the approved bare-key Git navigation map", () => {
    expect({
      next: shortcutKeys("git-next-item"),
      previous: shortcutKeys("git-previous-item"),
      open: shortcutKeys("git-open-item"),
      back: shortcutKeys("git-back"),
      viewed: shortcutKeys("git-toggle-viewed"),
      stage: shortcutKeys("git-stage-file"),
      reset: shortcutKeys("git-reset-file"),
      down: shortcutKeys("git-scroll-down"),
      up: shortcutKeys("git-scroll-up"),
    }).toEqual({
      next: ["j"],
      previous: ["k"],
      open: ["l"],
      back: ["h"],
      viewed: ["v"],
      stage: ["s"],
      reset: ["r"],
      down: ["d"],
      up: ["u"],
    });
  });

  it("registers the approved persisted Git view map", () => {
    expect({
      uncommitted: shortcutKeys("git-show-uncommitted"),
      target: shortcutKeys("git-show-vs-target"),
      commits: shortcutKeys("git-show-commits"),
      branches: shortcutKeys("git-show-branches"),
      stashes: shortcutKeys("git-show-stashes"),
    }).toEqual({
      uncommitted: ["mod", "u"],
      target: ["mod", "t"],
      commits: ["mod", "h"],
      branches: ["mod", "l"],
      stashes: ["mod", "s"],
    });
  });

  it("removes the superseded Ctrl-based diff shortcut identifiers", () => {
    const ids = new Set(SHORTCUTS.map((shortcut) => shortcut.id));
    expect(ids).not.toContain("diff-next-file");
    expect(ids).not.toContain("diff-prev-file");
    expect(ids).not.toContain("diff-toggle-file");
    expect(ids).not.toContain("diff-scroll-down");
    expect(ids).not.toContain("diff-scroll-up");
    expect(ids).not.toContain("diff-mark-viewed");
    expect(ids).not.toContain("diff-open-focused-file");
  });

  it("scopes new-session to feature pages and gives the agents view its own mod+shift+n", () => {
    const newSession = SHORTCUTS.find((s) => s.id === "new-session");
    const agentsNew = SHORTCUTS.find((s) => s.id === "agents-new-feature");
    expect(newSession?.scope).toBe("feature");
    expect(newSession?.keys).toEqual(["mod", "shift", "n"]);
    expect(agentsNew?.scope).toBe("unified-agents");
    expect(agentsNew?.keys).toEqual(["mod", "shift", "n"]);
  });

  it("registers find-in-conversation on mod+f in the agent scope", () => {
    const conversationSearch = SHORTCUTS.find((s) => s.id === "conversation-search");
    expect(conversationSearch?.keys).toEqual(["mod", "f"]);
    expect(conversationSearch?.scope).toBe("agent");
    // mod+f is shared with the editor's "find in current file" — a deliberate
    // cross-scope reuse, gated by which tab is focused. They must NOT collide
    // within the same scope.
    const editorSearch = SHORTCUTS.find((s) => s.id === "editor-buffer-search");
    expect(editorSearch?.keys).toEqual(["mod", "f"]);
    expect(editorSearch?.scope).not.toBe(conversationSearch?.scope);
  });
});
