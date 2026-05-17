import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { WorktreeList } from "./WorktreeList";

type OnSettledFn = () => void;

const worktreeData = [
  {
    path: "/wt/feature-a",
    branch: "feature/a",
    head: "abc123",
    feature_id: 1,
    feature_title: "Feature A",
    feature_status: "active",
  },
  {
    path: "/wt/feature-b",
    branch: "feature/b",
    head: "def456",
    feature_id: 2,
    feature_title: "Feature B",
    feature_status: "archived",
  },
  {
    path: "/wt/orphan",
    branch: "orphan-branch",
    head: "ghi789",
    feature_id: null,
    feature_title: null,
    feature_status: null,
  },
];

let mockDeleteMutate: Mock;
let mockRemoveOrphanMutate: Mock;

const { mockListQuery, mockDeleteWorktree, mockRemoveOrphan } = vi.hoisted(() => ({
  mockListQuery: vi.fn(),
  mockDeleteWorktree: vi.fn(),
  mockRemoveOrphan: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useListProjectWorktrees: mockListQuery,
  useDeleteWorktree: mockDeleteWorktree,
  useRemoveOrphanWorktree: mockRemoveOrphan,
  getListProjectWorktreesQueryKey: vi.fn(() => ["git", "worktrees"]),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteMutate = vi.fn();
  mockRemoveOrphanMutate = vi.fn();

  mockListQuery.mockReturnValue({
    data: worktreeData,
    isLoading: false,
  });

  mockDeleteWorktree.mockImplementation((opts: { onSuccess?: () => void }) => ({
    mutate: (...args: unknown[]) => {
      mockDeleteMutate(...args);
    },
    isLoading: false,
    ...opts,
  }));

  mockRemoveOrphan.mockImplementation((opts: { onSuccess?: () => void }) => ({
    mutate: (...args: unknown[]) => {
      mockRemoveOrphanMutate(...args);
    },
    isLoading: false,
    ...opts,
  }));
});

describe("WorktreeList", () => {
  it("shows loading state", () => {
    mockListQuery.mockReturnValue({ data: undefined, isLoading: true });
    render(<WorktreeList projectId={1} />);
    expect(screen.getByText(/loading worktrees/i)).toBeInTheDocument();
  });

  it("shows empty state when no worktrees", () => {
    mockListQuery.mockReturnValue({ data: [], isLoading: false });
    render(<WorktreeList projectId={1} />);
    expect(screen.getByText(/no worktrees/i)).toBeInTheDocument();
  });

  it("renders all worktrees", () => {
    render(<WorktreeList projectId={1} />);
    expect(screen.getByText("feature/a")).toBeInTheDocument();
    expect(screen.getByText("feature/b")).toBeInTheDocument();
    expect(screen.getByText("orphan-branch")).toBeInTheDocument();
  });

  it("makes archived feature attachments visible in project settings", () => {
    render(<WorktreeList projectId={1} />);

    const archivedBadge = screen.getByText("Archived feature");

    expect(archivedBadge).toHaveClass("bg-amber-500/10");
    expect(archivedBadge).toHaveClass("border-amber-500/45");
  });

  it("requires double-click to confirm deletion", async () => {
    render(<WorktreeList projectId={1} />);
    const buttons = screen.getAllByRole("button");

    // First click sets confirm state, does not mutate
    await buttons[0].click();
    expect(mockDeleteMutate).not.toHaveBeenCalled();

    // Second click triggers mutation
    await buttons[0].click();
    expect(mockDeleteMutate).toHaveBeenCalled();
  });

  it("replaces button with spinner while deleting", async () => {
    mockDeleteWorktree.mockImplementation((hookOpts: { onSuccess?: () => void }) => ({
      mutate: (input: unknown, opts: { onSettled?: OnSettledFn }) => {
        mockDeleteMutate(input, opts);
      },
      isLoading: false,
      ...hookOpts,
    }));

    const { user, container } = render(<WorktreeList projectId={1} />);
    const buttons = screen.getAllByRole("button");

    await user.click(buttons[0]);
    await user.click(buttons[0]);

    // Button is replaced with a CSS spinner, not disabled
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
    // Other buttons remain
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("allows deleting multiple worktrees concurrently", async () => {
    mockDeleteWorktree.mockImplementation((hookOpts: { onSuccess?: () => void }) => ({
      mutate: (input: unknown, opts: { onSettled?: OnSettledFn }) => {
        mockDeleteMutate(input, opts);
      },
      isLoading: false,
      ...hookOpts,
    }));

    const { user } = render(<WorktreeList projectId={1} />);
    const buttons = screen.getAllByRole("button");

    // Delete first worktree (double-click)
    await user.click(buttons[0]);
    await user.click(buttons[0]);

    // After first deletion, buttons[0] is gone; second worktree's button is now first
    const remainingButtons = screen.getAllByRole("button");
    await user.click(remainingButtons[0]);
    await user.click(remainingButtons[0]);

    expect(mockDeleteMutate).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("restores button after deletion completes (onSettled)", async () => {
    let capturedOnSettled: OnSettledFn | undefined;
    mockDeleteWorktree.mockImplementation((hookOpts: { onSuccess?: () => void }) => ({
      mutate: (input: unknown, opts: { onSettled?: OnSettledFn }) => {
        capturedOnSettled = opts?.onSettled;
        mockDeleteMutate(input, opts);
      },
      isLoading: false,
      ...hookOpts,
    }));

    const { user } = render(<WorktreeList projectId={1} />);
    const buttons = screen.getAllByRole("button");

    await user.click(buttons[0]);
    await user.click(buttons[0]);
    expect(screen.getAllByRole("button")).toHaveLength(2);

    capturedOnSettled!();

    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(3);
    });
  });

  it("uses removeOrphan mutation for worktrees without featureId", async () => {
    mockRemoveOrphan.mockImplementation((hookOpts: { onSuccess?: () => void }) => ({
      mutate: (input: unknown, opts: { onSettled?: OnSettledFn }) => {
        mockRemoveOrphanMutate(input, opts);
      },
      isLoading: false,
      ...hookOpts,
    }));

    const { user } = render(<WorktreeList projectId={1} />);
    const buttons = screen.getAllByRole("button");

    await user.click(buttons[2]);
    await user.click(buttons[2]);

    expect(mockRemoveOrphanMutate).toHaveBeenCalled();
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});
