import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import { StashesView } from "./StashesView";

const mockUseListStashes = vi.fn();
const mockDiffViewer = vi.fn();

vi.mock("@/api/generated", () => ({
  useListStashes: (...args: unknown[]) => mockUseListStashes(...args),
}));

vi.mock("./DiffViewer", () => ({
  DiffViewer: (props: unknown) => {
    mockDiffViewer(props);
    return <div>Revision diff</div>;
  },
}));

describe("StashesView", () => {
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
    });
    render(<StashesView featureId={9} />);

    fireEvent.click(screen.getByRole("button", { name: /stash@\{0\}WIP on feature/ }));
    expect(screen.getByRole("button", { name: "Stashes" })).toBeInTheDocument();
    expect(screen.getByText("Revision diff")).toBeInTheDocument();
    expect(mockDiffViewer).toHaveBeenCalledWith({
      featureId: 9,
      mode: "worktree",
      commitSha: "abc123",
    });
  });
});
