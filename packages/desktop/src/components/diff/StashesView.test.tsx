import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act, fireEvent, render, screen, waitFor } from "@/test-utils";
import { StashesView } from "./StashesView";
import {
  resetStashMutationCoordinatorForTest,
  useStashMutationCoordinator,
  type StashMutationLease,
} from "./useStashMutationCoordinator";
import type { GitNavigationAdapter } from "./gitNavigation";

const mockUseListStashes = vi.fn();
const mockDiffViewer = vi.fn();
const mutationResult = {
  mutateAsync: vi.fn().mockResolvedValue({ outcome: "completed" }),
  isPending: false,
};

vi.mock("@/api/generated", () => ({
  useListStashes: (...args: unknown[]) => mockUseListStashes(...args),
  useApplyStash: () => mutationResult,
  usePopStash: () => mutationResult,
  useDropStash: () => mutationResult,
}));

vi.mock("./DiffViewer", () => ({
  DiffViewer: (props: unknown) => {
    mockDiffViewer(props);
    return <div>Revision diff</div>;
  },
}));

describe("StashesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStashMutationCoordinatorForTest();
    mutationResult.mutateAsync.mockResolvedValue({ outcome: "completed" });
  });

  it("opens a stash in the shared revision diff frame", () => {
    mockUseListStashes.mockReturnValue({
      data: [
        {
          ref_name: "stash@{0}",
          sha: "abc123",
          message: "WIP on feature",
          date: "2026-01-01 12:00:00 +0000",
          files_changed: 1,
          additions: 2,
          deletions: 1,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    });
    render(<StashesView featureId={9} />);

    fireEvent.click(screen.getByRole("button", { name: "Open stash@{0}: WIP on feature" }));
    expect(screen.getByRole("button", { name: "Stashes" })).toBeInTheDocument();
    expect(screen.getByText("Revision diff")).toBeInTheDocument();
    expect(mockDiffViewer).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: 9,
        mode: "worktree",
        commitSha: "abc123",
        registerNavigationAdapter: expect.any(Function),
      }),
    );
  });

  it("navigates, opens, and returns from a stash through the Git adapter", () => {
    mockUseListStashes.mockReturnValue({
      data: [
        {
          ref_name: "stash@{0}",
          sha: "abc123",
          message: "First stash",
          date: "2026-01-02 12:00:00 +0000",
          files_changed: 1,
          additions: 2,
          deletions: 1,
        },
        {
          ref_name: "stash@{1}",
          sha: "def456",
          message: "Second stash",
          date: "2026-01-01 12:00:00 +0000",
          files_changed: 2,
          additions: 3,
          deletions: 2,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    });
    const capture: { current: GitNavigationAdapter | null } = { current: null };
    render(
      <StashesView
        featureId={9}
        registerNavigationAdapter={(next) => {
          capture.current = next;
          return () => {};
        }}
      />,
    );

    expect(capture.current?.getActiveItem()).toBe("stash@{0}");
    act(() => expect(capture.current?.moveSelection(1)).toBe(true));
    expect(capture.current?.getActiveItem()).toBe("stash@{1}");
    act(() => expect(capture.current?.open()).toBe(true));
    expect(screen.getByText("Revision diff")).toBeInTheDocument();
    act(() => expect(capture.current?.back()).toBe(true));
    expect(
      screen.getByRole("button", { name: "Open stash@{1}: Second stash" }),
    ).toBeInTheDocument();
  });

  it("keeps a stash row until a pop is confirmed and the list refetches", async () => {
    let completePop: ((value: { outcome: "completed" }) => void) | undefined;
    let completeRefetch: ((value: { data: never[] }) => void) | undefined;
    mutationResult.mutateAsync.mockReturnValue(
      new Promise<{ outcome: "completed" }>((resolve) => {
        completePop = resolve;
      }),
    );
    const refetch = vi.fn(
      () =>
        new Promise<{ data: never[] }>((resolve) => {
          completeRefetch = resolve;
        }),
    );
    mockUseListStashes.mockReturnValue({
      data: [
        {
          ref_name: "stash@{0}",
          sha: "abc123",
          message: "WIP on feature",
          date: "2026-01-01 12:00:00 +0000",
          files_changed: 1,
          additions: 2,
          deletions: 1,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    const { user } = render(<StashesView featureId={9} />);

    await user.click(screen.getByRole("button", { name: "Pop stash@{0}" }));

    expect(screen.getByRole("button", { name: "Open stash@{0}: WIP on feature" })).toBeVisible();
    expect(refetch).not.toHaveBeenCalled();

    await act(async () => {
      completePop?.({ outcome: "completed" });
    });
    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Open stash@{0}: WIP on feature" })).toBeVisible();

    await act(async () => {
      completeRefetch?.({ data: [] });
    });
  });

  it("blocks every other row while one stash mutation and refresh are pending", async () => {
    let completeApply: ((value: { outcome: "completed" }) => void) | undefined;
    let completeRefetch: ((value: { data: never[] }) => void) | undefined;
    mutationResult.mutateAsync.mockReturnValue(
      new Promise<{ outcome: "completed" }>((resolve) => {
        completeApply = resolve;
      }),
    );
    const refetch = vi.fn(
      () =>
        new Promise<{ data: never[] }>((resolve) => {
          completeRefetch = resolve;
        }),
    );
    mockUseListStashes.mockReturnValue({
      data: [
        {
          ref_name: "stash@{0}",
          sha: "a".repeat(40),
          message: "First stash",
          date: "2026-01-02 12:00:00 +0000",
          files_changed: 1,
          additions: 2,
          deletions: 1,
        },
        {
          ref_name: "stash@{1}",
          sha: "a".repeat(40),
          message: "Second stash",
          date: "2026-01-01 12:00:00 +0000",
          files_changed: 2,
          additions: 4,
          deletions: 2,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    const { user } = render(<StashesView featureId={9} />);

    await user.click(screen.getByRole("button", { name: "Apply stash@{0}" }));

    expect(
      await screen.findByRole("button", { name: "Apply stash@{0} in progress" }),
    ).toBeDisabled();
    const secondRowActions = screen.getByRole("button", {
      name: "Apply stash@{1}",
    });
    expect(secondRowActions).toBeDisabled();
    fireEvent.click(secondRowActions);
    expect(mutationResult.mutateAsync).toHaveBeenCalledOnce();

    await act(async () => {
      completeApply?.({ outcome: "completed" });
    });
    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(secondRowActions).toBeDisabled();
    fireEvent.click(secondRowActions);
    expect(mutationResult.mutateAsync).toHaveBeenCalledOnce();

    await act(async () => {
      completeRefetch?.({ data: [] });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply stash@{1}" })).toBeEnabled(),
    );
  });

  it("blocks row Apply, Pop, and Drop while a stash push is pending", async () => {
    mockUseListStashes.mockReturnValue({
      data: [
        {
          ref_name: "stash@{0}",
          sha: "a".repeat(40),
          message: "First stash",
          date: "2026-01-02 12:00:00 +0000",
          files_changed: 1,
          additions: 2,
          deletions: 1,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    });
    const { result } = renderHook(() => useStashMutationCoordinator(9));
    let lease: StashMutationLease | null = null;
    act(() => {
      lease = result.current.tryAcquire({ kind: "push" });
    });

    render(<StashesView featureId={9} />);

    expect(screen.getByRole("button", { name: "Apply stash@{0}" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pop stash@{0}" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Drop stash@{0}" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply stash@{0}" })).toHaveAttribute(
      "title",
      "Stash changes request in progress",
    );

    act(() => {
      if (lease) result.current.release(lease);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply stash@{0}" })).toBeEnabled(),
    );
  });
});
