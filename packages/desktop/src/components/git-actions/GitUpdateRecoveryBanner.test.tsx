import type { ReactElement } from "react";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitOperationResponse, GitStatusSnapshot } from "@/api/generated";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import { render, screen } from "@/test-utils";
import { GitUpdateRecoveryRegion } from "./GitUpdateRecoveryBanner";
import { recordGitUpdateConflicts, useGitUpdateRecoveryStore } from "./gitUpdateRecoveryStore";
import { useGitUpdatePending } from "./useGitUpdatePending";

const mocks = vi.hoisted(() => ({
  continueMutateAsync: vi.fn(),
  abortMutateAsync: vi.fn(),
  continuePending: false,
  abortPending: false,
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
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

function recordFirstConflict(): void {
  recordGitUpdateConflicts({
    featureId: 42,
    operation: "rebase",
    conflictFiles: ["src/first.ts"],
    computedAt: 10,
    statusOperation: null,
  });
}

function PendingProbe(): ReactElement {
  const pending = useGitUpdatePending(42);
  return <output data-testid="update-pending">{pending ? "pending" : "idle"}</output>;
}

function deferredResponse(): {
  promise: Promise<GitOperationResponse>;
  resolve: (response: GitOperationResponse) => void;
} {
  let resolve = (_response: GitOperationResponse): void => undefined;
  const promise = new Promise<GitOperationResponse>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.continueMutateAsync.mockReset();
  mocks.abortMutateAsync.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastWarning.mockReset();
  mocks.toastError.mockReset();
  mocks.continuePending = false;
  mocks.abortPending = false;
  useGitUpdateRecoveryStore.setState({ byFeature: {} });
  useGitStatusStore.setState({ byFeature: {}, errorByFeature: {}, watcherEpoch: {} });
  useGitStatusStore.getState().setStatus(snapshot());
});

describe("GitUpdateRecoveryRegion", () => {
  it("does not publish recovery changes for status-only synchronization", () => {
    const listener = vi.fn();
    const unsubscribe = useGitUpdateRecoveryStore.subscribe(listener);

    useGitUpdateRecoveryStore.getState().syncStatus(42, "rebase", 11);

    expect(listener).not.toHaveBeenCalled();
    expect(useGitUpdateRecoveryStore.getState().byFeature).toEqual({});
    unsubscribe();
  });

  it("requests Uncommitted and exposes the first conflict batch before WS confirmation", async () => {
    recordFirstConflict();
    const onRequestUncommitted = vi.fn();
    render(<GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={onRequestUncommitted} />);

    expect(screen.getByRole("region", { name: "Git update recovery" })).toBeInTheDocument();
    expect(screen.getByText("src/first.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue rebase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abort rebase" })).toBeEnabled();
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledTimes(1));
  });

  it("enables Continue only after backend status reports conflict_count zero", async () => {
    recordFirstConflict();
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />,
    );

    act(() => {
      useGitStatusStore
        .getState()
        .setStatus(snapshot({ operation: "rebase", conflict_count: 1, computed_at: 11 }));
    });
    expect(screen.getByRole("button", { name: "Continue rebase" })).toBeDisabled();

    mocks.continueMutateAsync.mockResolvedValueOnce({ outcome: "completed" });
    act(() => {
      useGitStatusStore
        .getState()
        .setStatus(snapshot({ operation: "rebase", conflict_count: 0, computed_at: 12 }));
    });
    const continueButton = screen.getByRole("button", { name: "Continue rebase" });
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(mocks.continueMutateAsync).toHaveBeenCalledWith({ data: { feature_id: 42 } });
  });

  it("flips from the paused warning to a ready-to-continue state once conflicts clear", () => {
    recordFirstConflict();
    render(<GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />);

    act(() => {
      useGitStatusStore
        .getState()
        .setStatus(snapshot({ operation: "rebase", conflict_count: 1, computed_at: 11 }));
    });
    expect(screen.getByText("Rebase paused on conflicts")).toBeInTheDocument();

    act(() => {
      useGitStatusStore
        .getState()
        .setStatus(snapshot({ operation: "rebase", conflict_count: 0, computed_at: 12 }));
    });
    expect(screen.getByText("Rebase ready to continue")).toBeInTheDocument();
    expect(screen.queryByText("Rebase paused on conflicts")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue rebase" })).toBeEnabled();
  });

  it("keeps a repeated Continue conflict recoverable and requests Uncommitted again", async () => {
    recordFirstConflict();
    useGitStatusStore
      .getState()
      .setStatus(snapshot({ operation: "rebase", conflict_count: 0, computed_at: 11 }));
    mocks.continueMutateAsync.mockResolvedValueOnce({
      outcome: "conflicts",
      conflict_files: ["src/second.ts", "src/third.ts"],
    });
    const onRequestUncommitted = vi.fn();
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={onRequestUncommitted} />,
    );
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Continue rebase" }));

    expect(await screen.findByText("src/second.ts")).toBeInTheDocument();
    expect(screen.getByText("src/third.ts")).toBeInTheDocument();
    expect(screen.getByText("Conflict batch 2")).toBeInTheDocument();
    await waitFor(() => expect(onRequestUncommitted).toHaveBeenCalledTimes(2));
    expect(mocks.toastWarning).toHaveBeenCalledWith("Update paused for conflicts", {
      description: "src/second.ts, src/third.ts",
    });
  });

  it("aborts with the generated control payload and waits for operation=null status", async () => {
    recordFirstConflict();
    useGitStatusStore
      .getState()
      .setStatus(snapshot({ operation: "rebase", conflict_count: 1, computed_at: 11 }));
    mocks.abortMutateAsync.mockResolvedValueOnce({ outcome: "completed" });
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Abort rebase" }));

    expect(mocks.abortMutateAsync).toHaveBeenCalledWith({ data: { feature_id: 42 } });
    expect(screen.getByRole("region", { name: "Git update recovery" })).toBeInTheDocument();
    expect(useGitUpdateRecoveryStore.getState().byFeature[42]?.settling).toBe(true);

    act(() => {
      useGitStatusStore.getState().setStatus(snapshot({ operation: null, computed_at: 12 }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Git update recovery" })).not.toBeInTheDocument();
    });
  });

  it.each([
    { action: "continue", buttonName: "Continue rebase", successMessage: "Update completed" },
    { action: "abort", buttonName: "Abort rebase", successMessage: "Update aborted" },
  ] as const)(
    "keeps recovery cleared when $action HTTP completion follows operation=null status",
    async ({ action, buttonName, successMessage }) => {
      recordFirstConflict();
      useGitStatusStore
        .getState()
        .setStatus(snapshot({ operation: "rebase", conflict_count: 0, computed_at: 11 }));
      const response = deferredResponse();
      const mutation = action === "continue" ? mocks.continueMutateAsync : mocks.abortMutateAsync;
      mutation.mockReturnValueOnce(response.promise);
      const { user } = render(
        <>
          <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />
          <PendingProbe />
        </>,
      );

      await user.click(screen.getByRole("button", { name: buttonName }));
      expect(mutation).toHaveBeenCalledWith({ data: { feature_id: 42 } });

      act(() => {
        useGitStatusStore.getState().setStatus(snapshot({ operation: null, computed_at: 12 }));
      });
      await waitFor(() => {
        expect(
          screen.queryByRole("region", { name: "Git update recovery" }),
        ).not.toBeInTheDocument();
      });
      expect(useGitUpdateRecoveryStore.getState().byFeature[42]).toBeUndefined();

      await act(async () => {
        response.resolve({ outcome: "completed" });
        await response.promise;
      });

      await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(successMessage));
      expect(useGitUpdateRecoveryStore.getState().byFeature[42]).toBeUndefined();
      expect(screen.queryByRole("region", { name: "Git update recovery" })).not.toBeInTheDocument();
      expect(screen.getByTestId("update-pending")).toHaveTextContent("idle");
    },
  );

  it("keeps recovery visible for a null status that is not newer than the conflict baseline", () => {
    recordFirstConflict();
    render(<GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />);

    act(() => {
      useGitStatusStore.getState().setStatus(snapshot({ operation: null, computed_at: 10 }));
    });

    expect(screen.getByRole("region", { name: "Git update recovery" })).toBeInTheDocument();
  });

  it("surfaces Continue errors inline and as a toast", async () => {
    recordFirstConflict();
    useGitStatusStore
      .getState()
      .setStatus(snapshot({ operation: "rebase", conflict_count: 0, computed_at: 11 }));
    mocks.continueMutateAsync.mockRejectedValueOnce(new Error("rebase continue failed"));
    const { user } = render(
      <GitUpdateRecoveryRegion featureId={42} onRequestUncommitted={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Continue rebase" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("rebase continue failed");
    expect(mocks.toastError).toHaveBeenCalledWith("Could not continue the update", {
      description: "rebase continue failed",
    });
  });
});
