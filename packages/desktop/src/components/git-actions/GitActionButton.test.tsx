import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { GitStatusSnapshot } from "@/api/generated";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import { GitActionButton } from "./GitActionButton";

vi.mock("./MergeDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Merge branch" /> : null,
}));

function makeMergeableSnapshot(featureId: number): GitStatusSnapshot {
  return {
    feature_id: featureId,
    current_branch: "feature/test",
    target_branch: "origin/main",
    uncommitted_count: 0,
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0,
    ahead_of_remote: 0,
    behind_remote: 0,
    ahead_of_target: 1,
    has_remote: true,
    compare_url: null,
    action_label: "Open PR",
    computed_at: 1,
  };
}

function makeDirtyMergeableSnapshot(featureId: number): GitStatusSnapshot {
  return {
    ...makeMergeableSnapshot(featureId),
    uncommitted_count: 2,
  };
}

beforeEach(() => {
  useGitStatusStore.setState({ byFeature: {}, errorByFeature: {}, watcherEpoch: {} });
});

describe("GitActionButton shortcuts", () => {
  it("opens git actions with Cmd+G while an input is focused", async () => {
    useGitStatusStore.getState().setStatus(makeMergeableSnapshot(42));

    const { user } = render(
      <>
        <input aria-label="Focused input" />
        <GitActionButton featureId={42} />
      </>,
    );

    screen.getByLabelText("Focused input").focus();
    await user.keyboard("{Meta>}G{/Meta}");

    expect(await screen.findByPlaceholderText("Search git actions…")).toBeInTheDocument();
  });

  it("shows a Git actions shortcut tooltip on hover", async () => {
    useGitStatusStore.getState().setStatus(makeMergeableSnapshot(42));

    const { user } = render(<GitActionButton featureId={42} />);

    await user.hover(screen.getByRole("button", { name: /more git actions/i }));

    expect(await screen.findByText("Git actions")).toBeInTheDocument();
  });

  it("allows merge from the menu when the source worktree has uncommitted changes", async () => {
    useGitStatusStore.getState().setStatus(makeDirtyMergeableSnapshot(42));

    const { user } = render(<GitActionButton featureId={42} />);

    await user.click(screen.getByRole("button", { name: /more git actions/i }));
    await user.click(await screen.findByText("Merge"));

    expect(await screen.findByRole("dialog", { name: "Merge branch" })).toBeInTheDocument();
  });
});
