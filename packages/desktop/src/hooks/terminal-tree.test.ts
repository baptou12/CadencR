import { describe, it, expect } from "vitest";
import { isCwdStale, type TerminalLeaf } from "./terminal-tree";

function leaf(overrides: Partial<TerminalLeaf>): TerminalLeaf {
  return { type: "leaf", id: "p1", ptyId: "pty-1", cwd: "/repo", ...overrides };
}

describe("isCwdStale", () => {
  it("is true when a live pane's cwd differs from the expected cwd", () => {
    expect(isCwdStale(leaf({ cwd: "/repo" }), "/repo/.worktrees/x")).toBe(true);
  });

  it("is false when the cwd already matches", () => {
    expect(isCwdStale(leaf({ cwd: "/repo" }), "/repo")).toBe(false);
  });

  it("is false without a ptyId, cwd, or expected cwd (not yet ready)", () => {
    expect(isCwdStale(leaf({ ptyId: undefined }), "/other")).toBe(false);
    expect(isCwdStale(leaf({ cwd: undefined }), "/other")).toBe(false);
    expect(isCwdStale(leaf({}), null)).toBe(false);
  });

  it("is false once the mismatch warning has been dismissed", () => {
    expect(isCwdStale(leaf({ cwdWarningDismissed: true }), "/other")).toBe(false);
  });
});
