import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { MergeArchiveDialog } from "./MergeArchiveDialog";

const { mockCheckMergeConflicts } = vi.hoisted(() => ({
  mockCheckMergeConflicts: vi.fn(() => ({
    data: { has_conflicts: false, conflict_files: [] as string[] },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
  })),
}));

vi.mock("@/api/generated", () => ({
  useCheckMergeConflicts: mockCheckMergeConflicts,
  useHasUncommittedChanges: vi.fn(() => ({
    data: { has_changes: false },
    refetch: vi.fn(),
  })),
  useMergeFeatureBranch: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  useDeleteFeatureBranch: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  useDeleteWorktree: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  useUpdateFeatureStatus: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
}));

describe("MergeArchiveDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <MergeArchiveDialog open={false} onOpenChange={vi.fn()} projectId={1} featureId={1} />,
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders dialog with title when open", () => {
    render(<MergeArchiveDialog open={true} onOpenChange={vi.fn()} projectId={1} featureId={1} />);
    expect(screen.getByText("Merge & Archive")).toBeInTheDocument();
  });

  it("shows no conflicts message", () => {
    render(<MergeArchiveDialog open={true} onOpenChange={vi.fn()} projectId={1} featureId={1} />);
    expect(screen.getByText("No conflicts detected")).toBeInTheDocument();
  });

  it("shows merge button", () => {
    render(<MergeArchiveDialog open={true} onOpenChange={vi.fn()} projectId={1} featureId={1} />);
    expect(screen.getByRole("button", { name: /merge branch/i })).toBeInTheDocument();
  });

  it("shows archive section", () => {
    render(<MergeArchiveDialog open={true} onOpenChange={vi.fn()} projectId={1} featureId={1} />);
    expect(screen.getByRole("heading", { name: "Archive Feature" })).toBeInTheDocument();
  });

  it("disables merge when conflicts detected", () => {
    mockCheckMergeConflicts.mockReturnValueOnce({
      data: { has_conflicts: true as boolean, conflict_files: [] as string[] },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
    });

    render(<MergeArchiveDialog open={true} onOpenChange={vi.fn()} projectId={1} featureId={1} />);
    expect(screen.getByRole("button", { name: /merge branch/i })).toBeDisabled();
  });

  it("shows close button", () => {
    render(<MergeArchiveDialog open={true} onOpenChange={vi.fn()} projectId={1} featureId={1} />);
    expect(screen.getAllByRole("button", { name: /close/i }).length).toBeGreaterThan(0);
  });
});
