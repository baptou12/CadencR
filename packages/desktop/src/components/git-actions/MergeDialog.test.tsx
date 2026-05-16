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

  it("merges on Cmd+Enter while focus is on a merge-option radio card", async () => {
    mocks.mergeMutateAsync.mockImplementationOnce(() => new Promise(() => {}));

    const { user } = render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);
    // The new layout exposes merge options as radio cards inside the
    // "Merge option" radiogroup — focus one of them and confirm Cmd+Enter
    // still routes through the dialog's keydown handler.
    const group = screen.getByRole("radiogroup", { name: /merge option/i });
    const firstRadio = group.querySelector('[role="radio"]') as HTMLElement;
    firstRadio.focus();

    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(mocks.mergeMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("does not auto-focus a merge-option radio card on open", () => {
    // Regression: Radix Dialog's default `onOpenAutoFocus` used to land the
    // focus ring on the first radio card, contradicting the *selected* card
    // (the user's saved default may be `--no-ff`, not the first option).
    render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: /merge option/i });
    const radios = Array.from(group.querySelectorAll('[role="radio"]'));
    for (const radio of radios) {
      expect(radio).not.toBe(document.activeElement);
    }
  });

  it("renders visible keyboard-shortcut hints on the footer buttons", () => {
    render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);

    // The `<KbdShortcut>` badges render as `<kbd>` elements inside each
    // button. We assert their presence so the discoverable shortcut isn't
    // accidentally regressed back to a `title` tooltip.
    const cancel = screen.getByRole("button", { name: /cancel/i });
    const merge = screen.getByRole("button", { name: /^merge/i });
    expect(cancel.querySelector("kbd")).not.toBeNull();
    expect(merge.querySelector("kbd")).not.toBeNull();
  });

  it("renders the colored flag chips alongside each merge-option label", () => {
    render(<MergeDialog featureId={1076} open={true} onOpenChange={vi.fn()} />);

    // Same set of chips the settings page exposes.
    expect(screen.getByText("--no-ff")).toBeInTheDocument();
    expect(screen.getByText("--ff-only")).toBeInTheDocument();
    expect(screen.getByText("--squash")).toBeInTheDocument();
    expect(screen.getByText("Git default")).toBeInTheDocument();
  });
});
