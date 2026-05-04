/**
 * Unit coverage for `resolveWorktreeChoice` — the pure rule that maps the
 * two-chip state ("Use worktree" toggle + Branch picker) into the concrete
 * `WorktreeChoice` the route persists before sending the first prompt.
 *
 * The reuse-vs-new decision turns on `BranchInfo.attached_worktree_path`:
 * if the picked branch is already checked out in another worktree we
 * attach to it (mode=reuse); otherwise the picked branch becomes the base
 * for a fresh feature-named branch (mode=new).
 */
import { describe, expect, it } from "vitest";
import type { BranchInfo } from "@/api/generated";
import { resolveWorktreeChoice } from "./WorktreePopover";

function branch(name: string, attached?: string): BranchInfo {
  // Cast through unknown — the generated `BranchInfo` has more fields than
  // the resolver reads, but supplying every one in every test is noise.
  return {
    name,
    is_local: true,
    attached_worktree_path: attached ?? null,
    attached_feature_id: attached ? 7 : null,
  } as unknown as BranchInfo;
}

describe("resolveWorktreeChoice", () => {
  it("returns off when the toggle is off, regardless of branch pick", () => {
    expect(
      resolveWorktreeChoice({ useWorktree: false, selectedBranch: null, branches: [] }),
    ).toEqual({ kind: "off" });
    expect(
      resolveWorktreeChoice({
        useWorktree: false,
        selectedBranch: "develop",
        branches: [branch("develop")],
      }),
    ).toEqual({ kind: "off" });
  });

  it("returns new with no base when toggle is on and user keeps project default", () => {
    expect(
      resolveWorktreeChoice({ useWorktree: true, selectedBranch: null, branches: [] }),
    ).toEqual({ kind: "new", base: null });
  });

  it("returns new with explicit base when picked branch is unattached", () => {
    expect(
      resolveWorktreeChoice({
        useWorktree: true,
        selectedBranch: "develop",
        branches: [branch("develop")],
      }),
    ).toEqual({ kind: "new", base: "develop" });
  });

  it("returns reuse when picked branch is already attached to a worktree", () => {
    expect(
      resolveWorktreeChoice({
        useWorktree: true,
        selectedBranch: "feat/foo",
        branches: [branch("feat/foo", "/tmp/feat-foo-wt")],
      }),
    ).toEqual({ kind: "reuse", branch: "feat/foo" });
  });

  it("falls back to new when the branch list hasn't loaded yet", () => {
    // Branches=undefined is the route's pre-fetch state. We can't tell if
    // the branch is attached, so default to creating a new worktree on it
    // — the backend will fall back to attaching when the branch already
    // has a checkout (see `add_new_worktree`'s `already exists` branch).
    expect(
      resolveWorktreeChoice({
        useWorktree: true,
        selectedBranch: "develop",
        branches: undefined,
      }),
    ).toEqual({ kind: "new", base: "develop" });
  });
});
