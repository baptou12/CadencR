import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { WorktreeSetupSection } from "./WorktreeSetupSection";
import React from "react";

const { mockGetSettings, mockRetryMutate } = vi.hoisted(() => ({
  mockGetSettings: vi.fn<() => { data: unknown }>(() => ({ data: null })),
  mockRetryMutate: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useGetFeatureSettings: mockGetSettings,
  useRetryWorktreeSetup: vi.fn(() => ({ mutate: mockRetryMutate, isLoading: false })),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    createClient: vi.fn(() => ({})),
    Provider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useUtils: vi.fn(() => ({})),
  },
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

  it("shows done badge when step is done", () => {
    mockGetSettings.mockReturnValue({
      data: settingsArray({
        worktree_setup_step: "done",
        worktree_setup_log: "",
        worktree_setup_error: "",
        worktree_branch: "feature/test",
      }),
    });
    render(<WorktreeSetupSection featureId={1} projectId={1} />);
    expect(screen.getByText("done")).toBeInTheDocument();
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
