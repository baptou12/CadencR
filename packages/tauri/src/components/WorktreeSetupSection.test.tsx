import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { WorktreeSetupSection } from "./WorktreeSetupSection";

const { mockGetSettings, mockRetryWorktreeSetup } = vi.hoisted(() => ({
  mockGetSettings: vi.fn<() => { data: unknown }>(() => ({ data: null })),
  mockRetryWorktreeSetup: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useGetFeatureSettings: mockGetSettings,
}));

vi.mock("@/hooks/useWorkflowWebSocket", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ retryWorktreeSetup: mockRetryWorktreeSetup }),
}));

function settingsArray(obj: Record<string, string>) {
  return Object.entries(obj).map(([key, value]) => ({ key, value }));
}

describe("WorktreeSetupSection", () => {
  it("renders nothing when no step is set", () => {
    mockGetSettings.mockReturnValue({ data: null });
    const { container } = render(
      <WorktreeSetupSection featureId={1} projectId={1} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders worktree setup section when step is present", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "done",
        worktree_setup_log: "",
        worktree_setup_error: "",
        worktree_branch: "feature/my-branch",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("Worktree Setup")).toBeInTheDocument();
  });

  it("shows ready badge when step is done", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "done",
        worktree_setup_log: "",
        worktree_setup_error: "",
        worktree_branch: "feature/test",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("shows error badge when step is error", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "error",
        worktree_setup_log: "",
        worktree_setup_error: "Setup failed",
        worktree_branch: "",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("renders setup log with terminal styling in ws mode", async () => {
    const { user } = render(
      <WorktreeSetupSection
        featureId={1}
        projectId={1}
        wsWorktreeStatus="ready"
        wsWorktreeBranch="feat/test"
        wsWorktreeSetupOutput={["installing deps", "all done"]}
      />
    );
    await user.click(screen.getByText("Worktree Setup"));
    const logEl = screen.getByText((_, el) =>
      el?.tagName === "PRE" && el.textContent === "installing deps\nall done"
    );
    expect(logEl.className).toContain("bg-zinc-900");
    expect(logEl.className).toContain("text-zinc-100");
  });

  it("shows persisted log from snapshot on resume via ws mode", async () => {
    const { user } = render(
      <WorktreeSetupSection
        featureId={1}
        projectId={1}
        wsWorktreeStatus="ready"
        wsWorktreeBranch="feat/resume"
        wsWorktreeSetupOutput={["pnpm install", "completed"]}
      />
    );
    await user.click(screen.getByText("Worktree Setup"));
    expect(screen.getByText((_, el) =>
      el?.tagName === "PRE" && el.textContent === "pnpm install\ncompleted"
    )).toBeInTheDocument();
  });

  it("maps DB 'ready' value to done badge (not running)", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "ready",
        worktree_setup_log: "",
        worktree_setup_error: "",
        worktree_branch: "feature/ready-branch",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.queryByText("running")).not.toBeInTheDocument();
  });

  it("maps DB 'setup_running' value to running badge", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "setup_running",
        worktree_setup_log: "",
        worktree_setup_error: "",
        worktree_branch: "",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("maps DB 'setup_error' value to error badge", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "setup_error",
        worktree_setup_log: "",
        worktree_setup_error: "something broke",
        worktree_branch: "",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("shows error on 'Run setup commands' step when setup fails", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "setup_error",
        worktree_setup_log: "fnm: command not found",
        worktree_branch: "feature/my-branch",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    // Error should show on step 3, not step 2
    const steps = screen.getAllByText(/Define name|Create worktree|Run setup commands/);
    expect(steps).toHaveLength(3);
    // Log output should be visible
    expect(screen.getByText("fnm: command not found")).toBeInTheDocument();
  });

  it("expands on header click to show steps", async () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "done",
        worktree_setup_log: "",
        worktree_setup_error: "",
        worktree_branch: "feature/test",
      }),
    });
    const { user } = render(<WorktreeSetupSection featureId={1} projectId={1} />);
    await user.click(screen.getByText("Worktree Setup"));
    expect(screen.getByText("Define name")).toBeInTheDocument();
  });
});
