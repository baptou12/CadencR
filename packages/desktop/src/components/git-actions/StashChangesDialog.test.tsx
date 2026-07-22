import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { createTestQueryClient, render, screen, waitFor } from "@/test-utils";
import StashChangesDialog from "./StashChangesDialog";
import {
  resetStashMutationCoordinatorForTest,
  useStashMutationCoordinator,
} from "@/components/diff/useStashMutationCoordinator";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  resetMutation: vi.fn(),
  pending: false,
  filesResult: {
    data: [
      {
        path: "src/parser.ts",
        status: "unstaged",
        change_kind: "modified",
        additions: 12,
        deletions: 3,
      },
      {
        path: "notes.txt",
        status: "untracked",
        change_kind: "untracked",
        additions: 0,
        deletions: 0,
      },
    ],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/api/generated", async () => {
  const React = await import("react");
  return {
    getListStashesQueryKey: (params: unknown) => ["/api/git/stashes", params],
    useGetUncommittedFiles: () => mocks.filesResult,
    usePushStash: () => {
      const [error, setError] = React.useState<unknown>(null);
      const reset = React.useCallback(() => {
        mocks.resetMutation();
        setError(null);
      }, []);
      return {
        mutateAsync: async (variables: unknown) => {
          try {
            return await mocks.mutateAsync(variables);
          } catch (caught) {
            setError(caught);
            throw caught;
          }
        },
        isPending: mocks.pending,
        error,
        reset,
      };
    },
  };
});

describe("StashChangesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStashMutationCoordinatorForTest();
    mocks.pending = false;
    mocks.resetMutation.mockReset();
    mocks.filesResult.data = [
      {
        path: "src/parser.ts",
        status: "unstaged",
        change_kind: "modified",
        additions: 12,
        deletions: 3,
      },
      {
        path: "notes.txt",
        status: "untracked",
        change_kind: "untracked",
        additions: 0,
        deletions: 0,
      },
    ];
    mocks.filesResult.isLoading = false;
    mocks.filesResult.isError = false;
    mocks.filesResult.error = null;
    mocks.mutateAsync.mockResolvedValue({ outcome: "completed" });
  });

  it("summarizes files with numstats and submits tracked changes with a trimmed name", async () => {
    const onOpenChange = vi.fn();
    const { user } = render(<StashChangesDialog featureId={21} open onOpenChange={onOpenChange} />);

    expect(screen.getByText("src/parser.ts")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    expect(screen.getByText("· excluded")).toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", { name: /Name/ });
    await user.type(nameInput, "  parser WIP  ");
    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      data: { feature_id: 21, message: "parser WIP", include_untracked: false },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Stashed changes as “parser WIP”");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists a file with staged and unstaged changes exactly once", () => {
    mocks.filesResult.data = [
      {
        path: "src/both.ts",
        status: "both",
        change_kind: "modified",
        additions: 4,
        deletions: 2,
      },
    ];

    render(<StashChangesDialog featureId={32} open onOpenChange={vi.fn()} />);

    expect(screen.getByText("Staged & unstaged (1)")).toBeInTheDocument();
    expect(screen.getAllByText("src/both.ts")).toHaveLength(1);
    expect(screen.getByText("1 of 1 included")).toBeInTheDocument();
  });

  it("starts outside the name input and uses the layout-aware N mnemonic to focus it", async () => {
    render(<StashChangesDialog featureId={31} open onOpenChange={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: "Include untracked files" });
    const nameInput = screen.getByRole("textbox", { name: /Name/ });

    await waitFor(() => expect(checkbox).toHaveFocus());
    expect(nameInput).not.toHaveFocus();
    fireEvent.keyDown(checkbox, { key: "n", code: "KeyB" });

    expect(nameInput).toHaveFocus();
  });

  it("confirms with Cmd+Enter from the focused name input", async () => {
    const onOpenChange = vi.fn();
    const { user } = render(<StashChangesDialog featureId={29} open onOpenChange={onOpenChange} />);
    const checkbox = screen.getByRole("checkbox", { name: "Include untracked files" });
    const nameInput = screen.getByRole("textbox", { name: /Name/ });

    await waitFor(() => expect(checkbox).toHaveFocus());
    fireEvent.keyDown(checkbox, { key: "n", code: "KeyB" });
    expect(nameInput).toHaveFocus();
    await user.type(nameInput, "keyboard stash");
    fireEvent.keyDown(nameInput, { key: "Enter", code: "Enter", metaKey: true });

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        data: { feature_id: 29, message: "keyboard stash", include_untracked: false },
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancels with Escape from the default dialog focus", async () => {
    const onOpenChange = vi.fn();
    render(<StashChangesDialog featureId={30} open onOpenChange={onOpenChange} />);
    const checkbox = screen.getByRole("checkbox", { name: "Include untracked files" });

    await waitFor(() => expect(checkbox).toHaveFocus());
    fireEvent.keyDown(checkbox, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("creates an unnamed stash when the optional name is blank", async () => {
    const { user } = render(<StashChangesDialog featureId={22} open onOpenChange={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: /Name/ }), "   ");
    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      data: { feature_id: 22, message: null, include_untracked: false },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Stashed changes");
  });

  it("uses the layout-aware U mnemonic to include and stash untracked-only changes", async () => {
    mocks.filesResult.data = [
      {
        path: "draft.txt",
        status: "untracked",
        change_kind: "untracked",
        additions: 0,
        deletions: 0,
      },
    ];
    const { user } = render(<StashChangesDialog featureId={28} open onOpenChange={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: "Include untracked files" });
    const submit = screen.getByRole("button", { name: "Stash changes" });

    expect(submit).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "u");
    expect(checkbox).not.toBeChecked();
    await user.clear(screen.getByRole("textbox", { name: /Name/ }));
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "u", code: "KeyQ" });
    expect(checkbox).toBeChecked();
    expect(screen.getByText("· included")).toBeInTheDocument();
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      data: { feature_id: 28, message: null, include_untracked: true },
    });
  });

  it("shows pending state and disables closing actions", () => {
    mocks.pending = true;
    render(<StashChangesDialog featureId={23} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("textbox", { name: /Name/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stashing…" })).toBeDisabled();
  });

  it("blocks dispatch while a row mutation owns the feature coordinator", async () => {
    const { result } = renderHook(() => useStashMutationCoordinator(27));
    const lease = result.current.tryAcquire({
      kind: "row",
      operation: "apply",
      stashRefName: "stash@{0}",
    });
    const { user } = render(<StashChangesDialog featureId={27} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Apply stash@{0} in progress");
    expect(screen.getByRole("button", { name: "Stash changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Stash changes" }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      if (lease) result.current.release(lease);
    });
  });

  it("surfaces a backend stash error inline and stays open", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("No tracked changes are available to stash"));
    const onOpenChange = vi.fn();
    const { user } = render(<StashChangesDialog featureId={24} open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tracked changes are available to stash",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("clears a local response error across close and reopen", async () => {
    mocks.mutateAsync.mockResolvedValue({
      outcome: "conflicts",
      conflict_files: ["src/parser.ts"],
    });
    const onOpenChange = vi.fn();
    const view = render(<StashChangesDialog featureId={34} open onOpenChange={onOpenChange} />);

    await view.user.click(screen.getByRole("button", { name: "Stash changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stash creation unexpectedly reported conflicts",
    );

    view.rerender(<StashChangesDialog featureId={34} open={false} onOpenChange={onOpenChange} />);
    await waitFor(() => expect(mocks.resetMutation).toHaveBeenCalledOnce());
    view.rerender(<StashChangesDialog featureId={34} open onOpenChange={onOpenChange} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets a generated mutation error across close and reopen", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("stale backend failure"));
    const onOpenChange = vi.fn();
    const view = render(<StashChangesDialog featureId={35} open onOpenChange={onOpenChange} />);

    await view.user.click(screen.getByRole("button", { name: "Stash changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stale backend failure");

    view.rerender(<StashChangesDialog featureId={35} open={false} onOpenChange={onOpenChange} />);
    await waitFor(() => expect(mocks.resetMutation).toHaveBeenCalledOnce());
    view.rerender(<StashChangesDialog featureId={35} open onOpenChange={onOpenChange} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds its feature lease until creation and the confirmed query refresh settle", async () => {
    let complete: ((value: { outcome: "completed" }) => void) | undefined;
    let completeRefresh: (() => void) | undefined;
    mocks.mutateAsync.mockReturnValue(
      new Promise<{ outcome: "completed" }>((resolve) => {
        complete = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    const coordinator = renderHook(() => useStashMutationCoordinator(25));
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        completeRefresh = resolve;
      }),
    );
    const { user } = render(
      <StashChangesDialog featureId={25} open onOpenChange={onOpenChange} />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: "Stash changes" }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(coordinator.result.current.activeMutation).toEqual({ kind: "push" });

    act(() => complete?.({ outcome: "completed" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(coordinator.result.current.activeMutation).toEqual({ kind: "push" });

    act(() => completeRefresh?.());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(coordinator.result.current.activeMutation).toBeNull();
  });
});
