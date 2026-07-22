import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitOperationResponse, GitStatusSnapshot } from "@/api/generated";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import { render, screen } from "@/test-utils";
import { GitUpdateRecoveryRegion } from "./GitUpdateRecoveryBanner";

const mocks = vi.hoisted(() => ({
  continueMutateAsync: vi.fn(),
  abortMutateAsync: vi.fn(),
  continuePending: false,
  abortPending: false,
  changedFiles: {
    data: [] as Array<{ file: string; status: string; stage_state: string }>,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  FileStageState: { conflicted: "conflicted" },
  useGetChangedFiles: () => mocks.changedFiles,
  useContinueUpdateBranch: () => ({
    mutateAsync: mocks.continueMutateAsync,
    isPending: mocks.continuePending,
  }),
  useAbortUpdateBranch: () => ({
    mutateAsync: mocks.abortMutateAsync,
    isPending: mocks.abortPending,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
  },
}));

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
    behind_target: 1,
    target_resolved: true,
    conflict_count: 0,
    operation: null,
    has_remote: true,
    computed_at: 10,
    ...overrides,
  };
}

function setStatus(overrides: Partial<GitStatusSnapshot>): void {
  act(() => useGitStatusStore.getState().setStatus(snapshot(overrides)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.continuePending = false;
  mocks.abortPending = false;
  mocks.changedFiles.data = [];
  mocks.changedFiles.isLoading = false;
  mocks.changedFiles.isError = false;
  mocks.changedFiles.error = null;
  useGitStatusStore.setState({ byFeature: {}, errorByFeature: {}, watcherEpoch: {} });
  useGitStatusStore.getState().setStatus(snapshot());
});

describe("GitUpdateRecoveryRegion", () => {
  it("waits for canonical status even when HTTP reports conflicts first", async () => {
    const response: GitOperationResponse = {
      outcome: "conflicts",
      conflict_files: ["src/http-first.ts"],
    };
    mocks.continueMutateAsync.mockResolvedValueOnce(response);
    setStatus({ operation: "rebase", conflict_count: 0, computed_at: 11 });
    const onRequestUncommitted = vi.fn();
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={onRequestUncommitted} />,
    );

    await user.click(screen.getByRole("button", { name: "Continue rebase" }));
    expect(mocks.toastWarning).toHaveBeenCalledWith("Update paused for conflicts", {
      description: "src/http-first.ts",
    });
    expect(screen.queryByText("src/http-first.ts")).not.toBeInTheDocument();
    expect(onRequestUncommitted).not.toHaveBeenCalled();

    mocks.changedFiles.data = [
      { file: "src/http-first.ts", status: "UU", stage_state: "conflicted" },
    ];
    setStatus({ operation: "rebase", conflict_count: 1, computed_at: 12 });
    expect(await screen.findByText("src/http-first.ts")).toBeInTheDocument();
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledOnce());
  });

  it("renders a WS-first conflict immediately from canonical status and changed files", async () => {
    mocks.changedFiles.data = [
      { file: "src/ws-first.ts", status: "UU", stage_state: "conflicted" },
    ];
    useGitStatusStore
      .getState()
      .setStatus(snapshot({ operation: "merge", conflict_count: 1, computed_at: 11 }));
    const onRequestUncommitted = vi.fn();
    render(<GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={onRequestUncommitted} />);

    expect(screen.getByText("Merge paused on conflicts")).toBeInTheDocument();
    expect(screen.getByText("src/ws-first.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue merge" })).toBeDisabled();
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledOnce());
  });

  it("tracks repeated rebase batches only on confirmed zero-to-conflict transitions", async () => {
    const onRequestUncommitted = vi.fn();
    setStatus({ operation: "rebase", conflict_count: 1, computed_at: 11 });
    mocks.changedFiles.data = [{ file: "src/first.ts", status: "UU", stage_state: "conflicted" }];
    const view = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={onRequestUncommitted} />,
    );
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Conflict batch 1")).toBeInTheDocument();

    setStatus({ operation: "rebase", conflict_count: 0, computed_at: 12 });
    mocks.changedFiles.data = [{ file: "src/second.ts", status: "UU", stage_state: "conflicted" }];
    setStatus({ operation: "rebase", conflict_count: 1, computed_at: 13 });
    view.rerender(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={onRequestUncommitted} />,
    );

    expect(await screen.findByText("src/second.ts")).toBeInTheDocument();
    expect(screen.getByText("Conflict batch 2")).toBeInTheDocument();
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledTimes(2));
  });

  it("gates Continue from conflict_count and clears only on operation=null", async () => {
    setStatus({ operation: "rebase", conflict_count: 1, computed_at: 11 });
    mocks.abortMutateAsync.mockResolvedValueOnce({ outcome: "completed" });
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Continue rebase" })).toBeDisabled();

    setStatus({ operation: "rebase", conflict_count: 0, computed_at: 12 });
    expect(screen.getByRole("button", { name: "Continue rebase" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Abort rebase" }));
    expect(screen.getByRole("region", { name: "Git update recovery" })).toBeInTheDocument();

    setStatus({ operation: null, conflict_count: 0, computed_at: 13 });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Git update recovery" })).not.toBeInTheDocument(),
    );
  });

  it("surfaces changed-files and control errors visibly", async () => {
    mocks.changedFiles.isError = true;
    mocks.changedFiles.error = new Error("changed files unavailable");
    setStatus({ operation: "rebase", conflict_count: 0, computed_at: 11 });
    mocks.continueMutateAsync.mockRejectedValueOnce(new Error("continue failed"));
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />,
    );

    expect(screen.getByText(/changed files unavailable/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue rebase" }));
    expect(await screen.findByText("continue failed")).toBeInTheDocument();
    expect(mocks.toastError).toHaveBeenCalled();
  });
});
