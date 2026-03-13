import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { MergeArchiveDialog } from "./MergeArchiveDialog";

const { mockCheckMergeConflicts } = vi.hoisted(() => ({
  mockCheckMergeConflicts: vi.fn(() => ({
    data: { hasConflicts: false, conflictFiles: [] as string[] },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  })),
}));

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
      useUtils: vi.fn(() => ({
        features: {
          listByProject: { invalidate: vi.fn() },
          getById: { invalidate: vi.fn() },
        },
      })),
      git: {
        checkMergeConflicts: {
          useQuery: mockCheckMergeConflicts,
        },
        hasUncommittedChanges: {
          useQuery: vi.fn(() => ({
            data: { hasChanges: false },
            refetch: vi.fn(),
          })),
        },
        mergeFeatureBranch: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
        },
        deleteFeatureBranch: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
        },
        deleteWorktree: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
        },
      },
      features: {
        updateStatus: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
        },
      },
    },
  };
});

describe("MergeArchiveDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <MergeArchiveDialog
        open={false}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders dialog with title when open", () => {
    render(
      <MergeArchiveDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(screen.getByText("Merge & Archive")).toBeInTheDocument();
  });

  it("shows no conflicts message", () => {
    render(
      <MergeArchiveDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(screen.getByText("No conflicts detected")).toBeInTheDocument();
  });

  it("shows merge button", () => {
    render(
      <MergeArchiveDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(screen.getByRole("button", { name: /merge branch/i })).toBeInTheDocument();
  });

  it("shows archive section", () => {
    render(
      <MergeArchiveDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(screen.getByRole("heading", { name: "Archive Feature" })).toBeInTheDocument();
  });

  it("disables merge when conflicts detected", () => {
    mockCheckMergeConflicts.mockReturnValueOnce({
      data: { hasConflicts: true as boolean, conflictFiles: [] as string[] },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
    });

    render(
      <MergeArchiveDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(screen.getByRole("button", { name: /merge branch/i })).toBeDisabled();
  });

  it("shows close button", () => {
    render(
      <MergeArchiveDialog
        open={true}
        onOpenChange={vi.fn()}
        projectId={1}
        featureId={1}
      />
    );
    expect(screen.getAllByRole("button", { name: /close/i }).length).toBeGreaterThan(0);
  });
});
