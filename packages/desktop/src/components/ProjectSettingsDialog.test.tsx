import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

const generatedMocks = vi.hoisted(() => ({
  setProjectSetting: vi.fn(),
}));

vi.mock("../api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/generated")>()),
  useGetProjectSettings: vi.fn(() => ({ data: [] })),
  useSetProjectSetting: vi.fn(() => ({ mutate: generatedMocks.setProjectSetting })),
  useListProjectWorktrees: vi.fn(() => ({ data: [] })),
}));

vi.mock("./ModelSelector", () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

describe("ProjectSettingsDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="My Project"
        open={false}
        onOpenChange={vi.fn()}
      />,
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
      />,
    );
    expect(screen.getByText("My Project")).toBeInTheDocument();
    expect(screen.getByText(/Project settings/i)).toBeInTheDocument();
  });

  it("renders branch prefix input", () => {
    render(
      <ProjectSettingsDialog projectId={1} projectName="Test" open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText(/e.g. feature\//i)).toBeInTheDocument();
  });

  it("renders setup worktree label", () => {
    render(
      <ProjectSettingsDialog projectId={1} projectName="Test" open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText("Worktree setup commands")).toBeInTheDocument();
  });

  it("renders setup worktree commands as a shell editor", () => {
    render(
      <ProjectSettingsDialog projectId={1} projectName="Test" open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/pnpm install/i)).toHaveClass("font-mono");
  });

  it("does not render removed autonomy, parallel, or QA settings", () => {
    render(
      <ProjectSettingsDialog projectId={1} projectName="Test" open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.queryByRole("radiogroup", { name: /agent autonomy/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Parallel agent execution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/QA testing procedure/i)).not.toBeInTheDocument();
  });

  it("closes dialog when escape is pressed", async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
