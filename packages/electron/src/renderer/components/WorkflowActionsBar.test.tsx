import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { WorkflowActionsBar } from "./WorkflowActionsBar";

// Mock child components
vi.mock("@/components/MergeArchiveDialog", () => ({
  MergeArchiveDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="merge-dialog">Merge Dialog</div> : null,
}));

vi.mock("@/components/AgentPromptBar", () => ({
  AgentPromptBar: vi.fn(() => <div data-testid="agent-prompt-bar" />),
}));

describe("WorkflowActionsBar", () => {
  const defaultProps = {
    workflowStatus: "building" as string,
    featureId: 1,
    projectId: 1,
    featureType: "feature",
    allItemsDone: false,
    onStartSession: vi.fn(),
    onStartRefine: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onStartSession.mockClear();
    defaultProps.onStartRefine.mockClear();
  });

  it("returns null when workflow is idle", () => {
    const { container } = render(
      <WorkflowActionsBar {...defaultProps} workflowStatus="idle" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when workflow is planning", () => {
    const { container } = render(
      <WorkflowActionsBar {...defaultProps} workflowStatus="planning" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders action buttons when building", () => {
    render(<WorkflowActionsBar {...defaultProps} workflowStatus="building" />);
    expect(screen.getByText("Start Session")).toBeInTheDocument();
    expect(screen.getByText("Refine Plan")).toBeInTheDocument();
  });

  it("renders action buttons when paused", () => {
    render(<WorkflowActionsBar {...defaultProps} workflowStatus="paused" />);
    expect(screen.getByText("Start Session")).toBeInTheDocument();
    expect(screen.getByText("Refine Plan")).toBeInTheDocument();
  });

  it("renders action buttons when completed", () => {
    render(<WorkflowActionsBar {...defaultProps} workflowStatus="completed" />);
    expect(screen.getByText("Start Session")).toBeInTheDocument();
    expect(screen.getByText("Refine Plan")).toBeInTheDocument();
  });

  it("shows Merge & Archive button when completed and all items done", () => {
    render(
      <WorkflowActionsBar
        {...defaultProps}
        workflowStatus="completed"
        allItemsDone={true}
        featureType="feature"
      />,
    );
    expect(screen.getByText("Merge & Archive")).toBeInTheDocument();
  });

  it("does not show Merge & Archive when not completed", () => {
    render(
      <WorkflowActionsBar {...defaultProps} workflowStatus="building" allItemsDone={true} />,
    );
    expect(screen.queryByText("Merge & Archive")).not.toBeInTheDocument();
  });

  it("does not show Merge & Archive when featureType is not feature", () => {
    render(
      <WorkflowActionsBar
        {...defaultProps}
        workflowStatus="completed"
        allItemsDone={true}
        featureType="session"
      />,
    );
    expect(screen.queryByText("Merge & Archive")).not.toBeInTheDocument();
  });

  it("shows disabled Run Retrospective button when completed", () => {
    render(
      <WorkflowActionsBar {...defaultProps} workflowStatus="completed" />,
    );
    const retroButton = screen.getByText("Run Retrospective").closest("button");
    expect(retroButton).toBeDisabled();
  });

  it("does not show Run Retrospective when building", () => {
    render(
      <WorkflowActionsBar {...defaultProps} workflowStatus="building" />,
    );
    expect(screen.queryByText("Run Retrospective")).not.toBeInTheDocument();
  });

  it("toggles session prompt bar on Start Session click", async () => {
    const user = userEvent.setup();
    render(<WorkflowActionsBar {...defaultProps} />);
    expect(screen.queryByTestId("agent-prompt-bar")).not.toBeInTheDocument();
    await user.click(screen.getByText("Start Session"));
    expect(screen.getByTestId("agent-prompt-bar")).toBeInTheDocument();
    await user.click(screen.getByText("Start Session"));
    expect(screen.queryByTestId("agent-prompt-bar")).not.toBeInTheDocument();
  });

  it("toggles refine prompt bar on Refine Plan click", async () => {
    const user = userEvent.setup();
    render(<WorkflowActionsBar {...defaultProps} />);
    await user.click(screen.getByText("Refine Plan"));
    // Should show at least one prompt bar
    expect(screen.getByTestId("agent-prompt-bar")).toBeInTheDocument();
  });

  it("opens merge dialog when Merge & Archive is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowActionsBar
        {...defaultProps}
        workflowStatus="completed"
        allItemsDone={true}
        featureType="feature"
      />,
    );
    await user.click(screen.getByText("Merge & Archive"));
    expect(screen.getByTestId("merge-dialog")).toBeInTheDocument();
  });
});
