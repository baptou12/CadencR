import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { WorktreeList } from "./WorktreeList";

type OnSettledFn = () => void;

const worktreeData = [
  {
    path: "/wt/feature-a",
    branch: "feature/a",
    head: "abc123",
    featureId: 1,
    featureTitle: "Feature A",
    featureStatus: "in-progress",
  },
  {
    path: "/wt/feature-b",
    branch: "feature/b",
    head: "def456",
    featureId: 2,
    featureTitle: "Feature B",
    featureStatus: "done",
  },
  {
    path: "/wt/orphan",
    branch: "orphan-branch",
    head: "ghi789",
    featureId: null,
    featureTitle: null,
    featureStatus: null,
  },
];

let mockDeleteMutate: Mock;
let mockRemoveOrphanMutate: Mock;
let mockDeleteIsLoading: boolean;
let mockRemoveOrphanIsLoading: boolean;

const { mockListQuery, mockDeleteWorktree, mockRemoveOrphan } = vi.hoisted(() => ({
  mockListQuery: vi.fn(),
  mockDeleteWorktree: vi.fn(),
  mockRemoveOrphan: vi.fn(),
}));

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
      useUtils: vi.fn(() => ({
        git: { listProjectWorktrees: { invalidate: vi.fn() } },
      })),
      git: {
        listProjectWorktrees: { useQuery: mockListQuery },
        deleteWorktree: { useMutation: mockDeleteWorktree },
        removeOrphanWorktree: { useMutation: mockRemoveOrphan },
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteIsLoading = false;
  mockRemoveOrphanIsLoading = false;
  mockDeleteMutate = vi.fn();
  mockRemoveOrphanMutate = vi.fn();

  mockListQuery.mockReturnValue({
    data: worktreeData,
    isLoading: false,
  });

  mockDeleteWorktree.mockImplementation((opts: { onSuccess?: () => void }) => ({
    mutate: (...args: unknown[]) => {
      // Store onSuccess to call later if needed
      mockDeleteMutate(...args);
    },
    isLoading: mockDeleteIsLoading,
    ...opts,
  }));

  mockRemoveOrphan.mockImplementation((opts: { onSuccess?: () => void }) => ({
    mutate: (...args: unknown[]) => {
      mockRemoveOrphanMutate(...args);
    },
    isLoading: mockRemoveOrphanIsLoading,
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

  it("shows spinner on the specific worktree being deleted", async () => {
    // Make mutate capture the onSettled callback but not call it (simulating in-flight)
    mockDeleteWorktree.mockImplementation((hookOpts: { onSuccess?: () => void }) => ({
      mutate: (input: unknown, opts: { onSettled?: OnSettledFn }) => {
        mockDeleteMutate(input, opts);
        // Don't call onSettled — mutation stays in flight
      },
      isLoading: false,
      ...hookOpts,
    }));

    const { user } = render(<WorktreeList projectId={1} />);
    const buttons = screen.getAllByRole("button");

    // Double-click first worktree to trigger delete
    await user.click(buttons[0]);
    await user.click(buttons[0]);

    // The first button should be disabled (deleting)
    expect(buttons[0]).toBeDisabled();
    // The second button should NOT be disabled (can delete concurrently)
    expect(buttons[1]).not.toBeDisabled();
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

    // Delete second worktree (double-click)
    await user.click(buttons[1]);
    await user.click(buttons[1]);

    // Both should have triggered mutations
    expect(mockDeleteMutate).toHaveBeenCalledTimes(2);

    // Both buttons should be disabled (both in-flight)
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();
  });

  it("re-enables button after deletion completes (onSettled)", async () => {
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

    // Trigger delete
    await user.click(buttons[0]);
    await user.click(buttons[0]);
    expect(buttons[0]).toBeDisabled();

    // Simulate mutation completing
    capturedOnSettled!();

    // Re-render to pick up state change
    await waitFor(() => {
      expect(buttons[0]).not.toBeDisabled();
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

    // The orphan is the 3rd item (index 2)
    await user.click(buttons[2]);
    await user.click(buttons[2]);

    expect(mockRemoveOrphanMutate).toHaveBeenCalled();
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});
