import { describe, expect, it, vi } from "vitest";

import type { GitStatusSnapshot } from "@/api/generated";
import { render, screen } from "@/test-utils";
import { GitActionPopover } from "./GitActionPopover";
import { deriveGitAction } from "./useGitAction";

function snapshot(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    feature_id: 42,
    current_branch: "feature/update-ui",
    target_branch: "origin/main",
    uncommitted_count: 0,
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0,
    ahead_of_remote: 0,
    behind_remote: 0,
    ahead_of_target: 1,
    behind_target: 2,
    target_resolved: true,
    conflict_count: 0,
    operation: null,
    has_remote: true,
    compare_url: null,
    computed_at: 1,
    ...overrides,
  };
}

describe("GitActionPopover", () => {
  it("registers Update separately from existing finish-branch Merge", async () => {
    const onPick = vi.fn();
    const { user } = render(
      <GitActionPopover state={deriveGitAction(snapshot())} onPick={onPick} />,
    );

    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByText("Merge")).toBeInTheDocument();
    await user.click(screen.getByText("Update"));
    expect(onPick).toHaveBeenCalledWith("update");
  });

  it("keeps exact disabled reasons accessible on Update", () => {
    render(
      <GitActionPopover
        state={deriveGitAction(snapshot({ target_resolved: false }))}
        onPick={vi.fn()}
      />,
    );

    const update = screen.getByText("Update").closest("[cmdk-item]");
    expect(update).toHaveAttribute("title", "Target 'origin/main' does not resolve");
  });

  it("renders recovery commands with Continue disabled and Abort available", () => {
    render(
      <GitActionPopover
        state={deriveGitAction(
          snapshot({ operation: "merge", conflict_count: 2, uncommitted_count: 2 }),
        )}
        onPick={vi.fn()}
        recoveryControls={{
          pendingAction: null,
          error: null,
          onContinue: vi.fn(),
          onAbort: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText("Continue update").closest("[cmdk-item]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Abort update").closest("[cmdk-item]")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});
