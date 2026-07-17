import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import { GitBranchesView } from "./GitBranchesView";

const mockUseListBranches = vi.fn();

vi.mock("@/api/generated", () => ({
  useListBranches: (...args: unknown[]) => mockUseListBranches(...args),
}));

vi.mock("./GitGraphView", () => ({
  GitGraphView: ({
    branch,
    onBackToBranches,
  }: {
    branch: { name: string; is_local: boolean };
    onBackToBranches: () => void;
  }) => (
    <div>
      <span>
        Commits for {branch.is_local ? "local" : "remote"} {branch.name}
      </span>
      <button type="button" onClick={onBackToBranches}>
        Back to branches
      </button>
    </div>
  ),
}));

const branches = [
  { name: "feature/branches", is_local: true },
  { name: "main", is_local: true },
  { name: "origin/main", is_local: false },
];

beforeEach(() => {
  mockUseListBranches.mockReturnValue({
    data: branches,
    isLoading: false,
    isError: false,
    error: null,
  });
  useGitStatusStore.setState({ byFeature: {}, errorByFeature: {} });
  useGitStatusStore.getState().setStatus({
    feature_id: 7,
    current_branch: "feature/branches",
    target_branch: "main",
    uncommitted_count: 0,
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0,
    ahead_of_remote: 0,
    behind_remote: 0,
    ahead_of_target: 0,
    has_remote: false,
    computed_at: 1,
  });
});

describe("GitBranchesView", () => {
  it("lists every branch and opens the selected branch commits", () => {
    render(<GitBranchesView featureId={7} projectId={3} />);

    expect(mockUseListBranches).toHaveBeenCalledWith({ project_id: 3 });
    expect(screen.getByText("3 branches")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.getByText("remote")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open commits for remote origin/main" }));
    expect(screen.getByText("Commits for remote origin/main")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to branches" }));
    expect(screen.getByRole("button", { name: "Open commits for local main" })).toBeInTheDocument();
  });

  it("filters the virtualized list by branch name", () => {
    render(<GitBranchesView featureId={7} projectId={3} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search branches" }), {
      target: { value: "origin" },
    });

    expect(screen.getByText("1 branch")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open commits for local feature/branches" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open commits for remote origin/main" }),
    ).toBeInTheDocument();
  });

  it("keeps identically named local and remote branches distinct", () => {
    mockUseListBranches.mockReturnValue({
      data: [
        { name: "origin/main", is_local: true },
        { name: "origin/main", is_local: false },
      ],
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<GitBranchesView featureId={7} projectId={3} />);

    expect(
      screen.getByRole("button", { name: "Open commits for local origin/main" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open commits for remote origin/main" }));
    expect(screen.getByText("Commits for remote origin/main")).toBeInTheDocument();
  });

  it("shows visible loading and error states", () => {
    mockUseListBranches.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });
    const { unmount } = render(<GitBranchesView featureId={7} projectId={3} />);
    expect(screen.getByText("Loading branches…")).toBeInTheDocument();

    unmount();
    mockUseListBranches.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("repository unavailable"),
    });
    render(<GitBranchesView featureId={7} projectId={3} />);
    expect(screen.getByText("repository unavailable")).toBeInTheDocument();
  });
});
