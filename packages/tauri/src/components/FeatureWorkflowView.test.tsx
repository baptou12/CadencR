import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@/test-utils";
import { FeatureWorkflowView } from "./FeatureWorkflowView";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("../api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/generated")>()),
  useListModels: vi.fn(() => ({ data: [{ id: "opus[1m]", label: "Opus (1M)" }] })),
}));

const mockInvalidate = vi.fn();

const { mockUseWorkflowBackend } = vi.hoisted(() => ({
  mockUseWorkflowBackend: vi.fn(),
}));

vi.mock("@/hooks/useWsWorkflowBackend", () => ({
  useWsWorkflowBackend: mockUseWorkflowBackend,
}));

const defaultBackend = {
    workflowStatus: "idle",
    sessionEntries: [],
    planSession: null,
    prdSession: null,
    reviewVerdict: null,
    queue: null,
    autonomyLevel: 3,
    error: null,
    clearError: vi.fn(),
    actions: {
      canStartPlan: true,
      canStartPrd: true,
      canStartBuild: false,
      canStartRisk: false,
      canStartReview: false,
      canStartWorkflowSession: false,
      canStartRefine: false,
      canStartRetro: false,
    },
    hasAnyAgentOutput: false,
    noAgentsRunning: true,
    view: "plan-input",
    isLoading: false,
    isStartingPlan: false,
    isStartingPrd: false,
    isStartingExecute: false,
    isStartingRisk: false,
    isStartingReview: false,
    isStartingRetro: false,
    isStartingFix: false,
    isContinuingBuild: false,
    isStartingWorkflowSession: false,
    isStartingRefinePlan: false,
    isAddingFixPhase: false,
    canContinueBuild: false,
    executeWaitingNextStep: null,
    executeStatus: "idle",
    planApprovalError: null,
    startPlan: vi.fn(),
    startPrd: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    startBuilding: vi.fn(),
    continueWorkflow: vi.fn(),
    sendToAgent: vi.fn(),
    stopAgent: vi.fn(),
    interruptAgent: vi.fn(),
    submitPermission: vi.fn(),
    submitAnswers: vi.fn(),
    startSession: vi.fn(),
    startRefine: vi.fn(),
    startRisk: vi.fn(),
    startReview: vi.fn(),
    startRetro: vi.fn(),
    startReviewFixer: vi.fn(),
    markDone: vi.fn(),
    deleteSession: vi.fn(),
    handleResume: vi.fn(),
  };

vi.mock("@/hooks/useResolvedModel", () => ({
  useResolvedModel: vi.fn(() => ({
    resolveModel: vi.fn(() => undefined),
    handleModelChange: vi.fn(),
  })),
}));

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: vi.fn(() => ({ value: undefined, setValue: vi.fn() })),
}));

vi.mock("@/hooks/useTerminalState", () => ({
  useTerminalState: vi.fn(() => ({
    terminalVisible: false,
    toggleTerminal: vi.fn(),
    panes: [],
    openPane: vi.fn(),
    closePane: vi.fn(),
  })),
  getLeaves: vi.fn(() => []),
  useTerminalStore: vi.fn((selector) =>
    selector({
      sendToTerminal: vi.fn(),
      clearInitialCommand: vi.fn(),
      features: {},
    }),
  ),
}));

vi.mock("@/components/FeatureTopBar", () => ({
  FeatureTopBar: ({ featureId }: { featureId: number }) => (
    <div data-testid="feature-top-bar">Feature {featureId}</div>
  ),
}));

vi.mock("@/components/diff/DiffViewerModal", () => ({
  DiffViewerModal: () => null,
}));

vi.mock("@/components/terminal/TerminalPanel", () => ({
  TerminalPanel: vi.fn(() => null),
}));

vi.mock("@/components/WorktreeSetupSection", () => ({
  WorktreeSetupSection: () => null,
}));

vi.mock("@/components/PlanSidebar", () => ({
  PlanSidebar: () => <div data-testid="plan-sidebar" />,
}));

vi.mock("@/components/QueueSidebar", () => ({
  QueueSidebar: () => <div data-testid="queue-sidebar" />,
}));

vi.mock("@/components/PlanInputView", () => ({
  PlanInputView: () => <div data-testid="plan-input-view" />,
}));

vi.mock("@/components/NextStepsBar", () => ({
  NextStepsBar: () => <div data-testid="next-steps-bar" />,
}));

const { MockAgentSession } = vi.hoisted(() => ({
  MockAgentSession: vi.fn(() => null),
}));

vi.mock("@/components/AgentSession", () => ({
  AgentSession: MockAgentSession,
  AGENT_LABELS: {
    plan: "Plan",
    prd: "PRD",
    execute: "Execute",
    risk: "Risk Analysis",
    review: "Review",
    session: "Session",
    qa: "QA",
  },
}));

const mockFeature = {
  id: 1,
  title: "Test Feature",
  status: "draft",
  type: "ws-feature",
  project_id: 1,
  created_at: "2024-01-01",
};

describe("FeatureWorkflowView", () => {
  beforeEach(() => {
    mockInvalidate.mockClear();
    mockUseWorkflowBackend.mockReturnValue(defaultBackend);
  });

  it("renders without crashing", () => {
    const { container } = render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(container).toBeInTheDocument();
  });

  it("renders feature top bar", () => {
    render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("feature-top-bar")).toBeInTheDocument();
  });

  it("renders queue sidebar", () => {
    render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("queue-sidebar")).toBeInTheDocument();
  });

  it("displays workflow error banner when backend.error is set", () => {
    mockUseWorkflowBackend.mockReturnValue({
      ...defaultBackend,
      view: "agents",
      error: "Failed to look up directory for project 2",
    });
    render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(
      screen.getByText("Failed to look up directory for project 2"),
    ).toBeInTheDocument();
  });

  it("does not display error banner when backend.error is null", () => {
    mockUseWorkflowBackend.mockReturnValue({
      ...defaultBackend,
      view: "agents",
      error: null,
    clearError: vi.fn(),
    });
    render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(
      screen.queryByText("Failed to look up directory for project 2"),
    ).not.toBeInTheDocument();
  });

  it("shows spinner when agents-active with no agent output", () => {
    mockUseWorkflowBackend.mockReturnValue({
      ...defaultBackend,
      view: "agents-active",
      workflowStatus: "building",
      hasAnyAgentOutput: false,
      sessionEntries: [],
    });
    const { container } = render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-input-view")).not.toBeInTheDocument();
  });

  it("does not show spinner when planning with no agent output", () => {
    mockUseWorkflowBackend.mockReturnValue({
      ...defaultBackend,
      view: "planning",
      workflowStatus: "planning",
      hasAnyAgentOutput: false,
      sessionEntries: [],
    });
    const { container } = render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("does not show spinner on plan-input view", () => {
    const { container } = render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("renders with undefined feature", () => {
    const { container } = render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={undefined}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(container).toBeInTheDocument();
  });

  describe("agent deletion confirm dialog", () => {
    const sessionEntry = {
      agentType: "execute",
      sessionDbId: 42,
      status: "idle",
      messages: [],
    };

    function renderWithAgent() {
      const deleteSession = vi.fn();
      mockUseWorkflowBackend.mockReturnValue({
        ...defaultBackend,
        view: "agents",
        sessionEntries: [sessionEntry],
        deleteSession,
      });
      render(
        <FeatureWorkflowView
          featureId={1}
          projectId={1}
          feature={mockFeature}
          featureQuery={{ refetch: vi.fn() }}
        />,
      );
      return { deleteSession };
    }

    it("shows confirm dialog when delete is triggered", () => {
      renderWithAgent();
      // Get the onDelete prop passed to AgentSession and invoke it
      const lastCall = (MockAgentSession.mock.calls as unknown[][]).at(-1);
      const props = lastCall?.[0] as Record<string, unknown>;
      act(() => { (props.onDelete as () => void)(); });
      expect(screen.getByText(/Remove "Execute" agent/)).toBeInTheDocument();
    });

    it("does not delete until user confirms", () => {
      const { deleteSession } = renderWithAgent();
      const lastCall = (MockAgentSession.mock.calls as unknown[][]).at(-1);
      const props = lastCall?.[0] as Record<string, unknown>;
      act(() => { (props.onDelete as () => void)(); });
      // Dialog is open but deleteSession not called yet
      expect(deleteSession).not.toHaveBeenCalled();
    });

    it("deletes session when user confirms", () => {
      const { deleteSession } = renderWithAgent();
      const lastCall = (MockAgentSession.mock.calls as unknown[][]).at(-1);
      const props = lastCall?.[0] as Record<string, unknown>;
      act(() => { (props.onDelete as () => void)(); });
      // Click the "Remove" confirm button
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(deleteSession).toHaveBeenCalledWith(42);
    });

    it("does not delete when user cancels", () => {
      const { deleteSession } = renderWithAgent();
      const lastCall = (MockAgentSession.mock.calls as unknown[][]).at(-1);
      const props = lastCall?.[0] as Record<string, unknown>;
      act(() => { (props.onDelete as () => void)(); });
      // Click Cancel
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(deleteSession).not.toHaveBeenCalled();
      // Dialog should be closed
      expect(screen.queryByText(/Remove "Execute" agent/)).not.toBeInTheDocument();
    });
  });

  describe("Generate Plan button", () => {
    const agentsView = {
      view: "agents",
      sessionEntries: [{ agentType: "execute", sessionDbId: 1, status: "completed", messages: [] }],
    };

    it("shows Generate Plan when canStartPlan and no paused plan agent", () => {
      mockUseWorkflowBackend.mockReturnValue({
        ...defaultBackend,
        ...agentsView,
        actions: { ...defaultBackend.actions, canStartPlan: true },
        planSession: null,
      });
      render(
        <FeatureWorkflowView featureId={1} projectId={1} feature={mockFeature} featureQuery={{ refetch: vi.fn() }} />,
      );
      expect(screen.getByRole("button", { name: /Generate Plan/ })).toBeInTheDocument();
    });

    it("hides Generate Plan when plan agent is resumable (paused)", () => {
      mockUseWorkflowBackend.mockReturnValue({
        ...defaultBackend,
        ...agentsView,
        actions: { ...defaultBackend.actions, canStartPlan: true },
        planSession: { resumable: true, status: "paused", sessionDbId: 10 },
      });
      render(
        <FeatureWorkflowView featureId={1} projectId={1} feature={mockFeature} featureQuery={{ refetch: vi.fn() }} />,
      );
      expect(screen.queryByRole("button", { name: /Generate Plan/ })).not.toBeInTheDocument();
    });
  });

  describe("error banner", () => {
    it("shows error with dismiss button and calls clearError on click", () => {
      const clearError = vi.fn();
      mockUseWorkflowBackend.mockReturnValue({
        ...defaultBackend,
        error: "Something went wrong",
        clearError,
      });

      render(<FeatureWorkflowView featureId={1} projectId={1} feature={mockFeature} featureQuery={{ refetch: vi.fn() }} />);

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      const dismissBtn = screen.getByRole("button", { name: "Dismiss error" });
      fireEvent.click(dismissBtn);
      expect(clearError).toHaveBeenCalledOnce();
    });

    it("does not show error banner when error is null", () => {
      mockUseWorkflowBackend.mockReturnValue({
        ...defaultBackend,
        error: null,
      });

      render(<FeatureWorkflowView featureId={1} projectId={1} feature={mockFeature} featureQuery={{ refetch: vi.fn() }} />);

      expect(screen.queryByRole("button", { name: "Dismiss error" })).not.toBeInTheDocument();
    });
  });
});
