import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";

const mocks = vi.hoisted(() => {
  const mergeMutateAsync = vi.fn();
  const useMergeFeatureBranch = vi.fn(() => ({
    mutateAsync: mergeMutateAsync,
    isPending: false,
  }));
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  return {
    mergeMutateAsync,
    useMergeFeatureBranch,
    toastSuccess,
    toastError,
  };
});

vi.mock("@/api/generated", () => ({
  getGetWorkspaceSettingQueryKey: (key: string): string[] => ["workspace-setting", key],
  useGetWorkspaceSetting: vi.fn(() => ({ data: null })),
  useMergeFeatureBranch: mocks.useMergeFeatureBranch,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

import MergeDialog from "./MergeDialog";

beforeEach(() => {
  mocks.mergeMutateAsync.mockReset();
  mocks.useMergeFeatureBranch.mockClear();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

describe("MergeDialog errors", () => {
  it("shows an explicit message when the target worktree has uncommitted changes", async () => {
    mocks.mergeMutateAsync.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: {
          error: "Bad request: target branch worktree has uncommitted changes",
          code: "BAD_REQUEST",
        },
      },
    });

    const { user } = render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Merge" }));

    const message =
      "Cannot merge because the target branch worktree has uncommitted changes. Commit, stash, or discard those changes, then try again.";
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows explicit source-worktree errors from non-throwing merge results", async () => {
    mocks.mergeMutateAsync.mockResolvedValueOnce({
      success: false,
      error: "Bad request: source feature worktree has uncommitted changes",
    });

    const { user } = render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Merge" }));

    expect(
      await screen.findByText(
        "Cannot merge because the source feature worktree has uncommitted changes. Commit, stash, or discard those changes, then try again.",
      ),
    ).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("merges on Cmd+Enter from the merge option select without opening the select", async () => {
    mocks.mergeMutateAsync.mockImplementationOnce(() => new Promise(() => {}));

    const { user } = render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);
    screen.getByRole("combobox", { name: /merge option/i }).focus();

    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(mocks.mergeMutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("option", { name: "Default" })).not.toBeInTheDocument();
  });
});
