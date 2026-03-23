import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

const { mockGetSettings, mockSetSetting } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(() => ({
    data: {
      branch_prefix: "feature/",
      agent_autonomy: "1",
      setup_worktree: "pnpm install",
      qa_prompt: "pnpm test",
    },
  })),
  mockSetSetting: vi.fn(),
}));

vi.mock("../api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/generated")>()),
  useListModels: vi.fn(() => ({ data: [{ id: "opus[1m]", label: "Opus (1M)" }] })),
}));

describe("ProjectSettingsDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="My Project"
        open={false}
        onOpenChange={vi.fn()}
      />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders dialog title with project name when open", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="My Project"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Project Settings: My Project")).toBeInTheDocument();
  });

  it("renders branch prefix input", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/e.g. feature\//i)).toBeInTheDocument();
  });

  it("renders setup worktree label", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Worktree Setup Commands")).toBeInTheDocument();
  });

  it("renders agent autonomy selector", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Agent Autonomy")).toBeInTheDocument();
  });

  it("closes dialog when escape is pressed", async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
