import { beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";

import type { GitStatusSnapshot } from "@/api/generated";
import { render, screen } from "@/test-utils";
import { useGitUpdateRecoveryStore } from "./gitUpdateRecoveryStore";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useUpdateBranch: () => ({ mutateAsync: mocks.mutateAsync, isPending: mocks.isPending }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));

import UpdateBranchDialog from "./UpdateBranchDialog";

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
    ahead_of_target: 4,
    behind_target: 7,
    target_resolved: true,
    conflict_count: 0,
    operation: null,
    has_remote: true,
    computed_at: 100,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastWarning.mockReset();
  mocks.isPending = false;
  useGitUpdateRecoveryStore.setState({ byFeature: {} });
});

describe("UpdateBranchDialog", () => {
  it("shows exact target-to-current direction and ahead/behind counts", () => {
    render(
      <UpdateBranchDialog
        featureId={42}
        open
        snapshot={snapshot()}
        disabledReason={null}
        onOpenChange={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Update current branch" });
    expect(within(dialog).getAllByText("origin/main")).toHaveLength(2);
    expect(within(dialog).getByText("feature/update-ui")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("updates")).toBeInTheDocument();
    expect(within(dialog).getByText("7")).toBeInTheDocument();
    expect(within(dialog).getByText("4")).toBeInTheDocument();
  });

  it("submits Rebase by default and the exact Merge strategy when selected", async () => {
    mocks.mutateAsync.mockResolvedValue({ outcome: "completed" });
    const onOpenChange = vi.fn();
    const { user } = render(
      <UpdateBranchDialog
        featureId={42}
        open
        snapshot={snapshot()}
        disabledReason={null}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Update branch" }));
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      data: { feature_id: 42, strategy: "rebase" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    await user.click(screen.getByRole("radio", { name: /Merge/ }));
    await user.click(screen.getByRole("button", { name: "Update branch" }));
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      data: { feature_id: 42, strategy: "merge" },
    });
  });

  it("closes after completion without changing Git status optimistically", async () => {
    mocks.mutateAsync.mockResolvedValueOnce({ outcome: "completed" });
    const onOpenChange = vi.fn();
    const { user } = render(
      <UpdateBranchDialog
        featureId={42}
        open
        snapshot={snapshot()}
        disabledReason={null}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Update branch" }));

    expect(mocks.toastSuccess).toHaveBeenCalledWith("Updated feature/update-ui from origin/main");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(useGitUpdateRecoveryStore.getState().byFeature[42]).toBeUndefined();
  });

  it("routes a first conflict batch to recoverable Uncommitted UI", async () => {
    mocks.mutateAsync.mockResolvedValueOnce({
      outcome: "conflicts",
      conflict_files: ["src/a.ts", "src/b.ts"],
    });
    const onOpenChange = vi.fn();
    const { user } = render(
      <UpdateBranchDialog
        featureId={42}
        open
        snapshot={snapshot()}
        disabledReason={null}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Update branch" }));

    expect(useGitUpdateRecoveryStore.getState().byFeature[42]).toMatchObject({
      operation: "rebase",
      conflictFiles: ["src/a.ts", "src/b.ts"],
      conflictBatch: 1,
      needsUncommittedView: true,
    });
    expect(mocks.toastWarning).toHaveBeenCalledWith("Update paused for conflicts", {
      description: "src/a.ts, src/b.ts",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces captured backend Git errors inside the dialog", async () => {
    mocks.mutateAsync.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "git rebase origin/main failed: protected branch" } },
    });
    const { user } = render(
      <UpdateBranchDialog
        featureId={42}
        open
        snapshot={snapshot()}
        disabledReason={null}
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Update branch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "git rebase origin/main failed: protected branch",
    );
  });

  it("shows pending state and disables strategy, submit, cancel, and close", () => {
    mocks.isPending = true;
    render(
      <UpdateBranchDialog
        featureId={42}
        open
        snapshot={snapshot()}
        disabledReason={null}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Rebase/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
