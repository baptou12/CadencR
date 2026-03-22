import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureWorkflowView } from "./FeatureWorkflowView";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

const mockInvalidate = vi.fn();

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      features: {
      getById: {
        useQuery: vi.fn(() => ({
          data: {
            id: 1,
            title: "Test Feature",
            status: "draft",
            type: "feature",
            project_id: 1,
            created_at: "2024-01-01",
          },
        })),
      },
      getProgress: {
        useQuery: vi.fn(() => ({ data: { done: 0, total: 0 } })),
      },
      getSettings: {
        useQuery: vi.fn(() => ({ data: { worktree_branch: null } })),
      },
      setSetting: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      updateStatus: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      getPlanWithPhases: {
        useQuery: vi.fn(() => ({ data: null })),
      },
      getPrd: {
        useQuery: vi.fn(() => ({ data: null })),
      },
    },
    agents: {
      start: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
      },
      stop: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      submitAnswers: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      submitToolPermission: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      submitPlanApproval: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      resume: {
        useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
      },
      setPermissionMode: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      markSessionDone: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
    },
    sessions: {
      getFeatureAgentState: {
        useQuery: vi.fn(() => ({
          data: {
            featureStatus: "idle",
            sessions: [],
            activeRunId: null,
          },
          refetch: vi.fn(),
        })),
      },
      deleteSession: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      getFeatureTurnStates: {
        useQuery: vi.fn(() => ({ data: {} })),
      },
    },
    workflow: {
      startReviewFixer: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
    },
    plans: {
      getByFeature: {
        useQuery: vi.fn(() => ({ data: null })),
      },
      create: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
      },
      update: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
    },
    git: {
      getStats: {
        useQuery: vi.fn(() => ({ data: { commits: 0, insertions: 0, deletions: 0 } })),
      },
      getBranch: {
        useQuery: vi.fn(() => ({ data: "main" })),
      },
      getDiff: {
        useQuery: vi.fn(() => ({ data: null })),
      },
      openInTerminal: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      openInZed: {
        useMutation: vi.fn(() => ({ mutate: vi.fn() })),
      },
      getWorktreeStatus: {
        useQuery: vi.fn(() => ({ data: null })),
      },
      setupWorktree: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
      },
    },
    workspace: {
      get: {
        useQuery: vi.fn(() => ({ data: null })),
      },
      getAvailableModels: {
        useQuery: vi.fn(() => ({ data: [] })),
      },
      getProjectSettings: {
        useQuery: vi.fn(() => ({ data: null })),
      },
    },
    projects: {
      getById: {
        useQuery: vi.fn(() => ({ data: { id: 1, name: "Test Project", path: "/test" } })),
      },
    },
    useUtils: vi.fn(() => ({
      sessions: { getFeatureAgentState: { invalidate: mockInvalidate } },
      features: {
        getById: { invalidate: mockInvalidate },
        getProgress: { invalidate: mockInvalidate },
        getSettings: { invalidate: mockInvalidate },
      },
      plans: { getByFeature: { invalidate: mockInvalidate } },
    })),
    },
  };
});

const { mockUseWorkflowBackend } = vi.hoisted(() => ({
  mockUseWorkflowBackend: vi.fn(),
}));

vi.mock("@/hooks/useWorkflowBackend", () => ({
  useWorkflowBackend: mockUseWorkflowBackend,
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

vi.mock("@/hooks/useContextUsage", () => ({
  useContextUsage: vi.fn(() => new Map()),
}));

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
  useTerminalStore: vi.fn((selector) =>
    selector({ sendToTerminal: vi.fn(), clearInitialCommand: vi.fn() }),
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

vi.mock("@/components/PlanInputView", () => ({
  PlanInputView: () => <div data-testid="plan-input-view" />,
}));

vi.mock("@/components/NextStepsBar", () => ({
  NextStepsBar: () => <div data-testid="next-steps-bar" />,
}));

vi.mock("@/components/AgentSession", () => ({
  AgentSession: vi.fn(() => null),
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
  type: "feature",
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

  it("renders plan sidebar", () => {
    render(
      <FeatureWorkflowView
        featureId={1}
        projectId={1}
        feature={mockFeature}
        featureQuery={{ refetch: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("plan-sidebar")).toBeInTheDocument();
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

  it("shows spinner when planning with no agent output", () => {
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
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-input-view")).not.toBeInTheDocument();
  });

  it("shows spinner when prd with no agent output", () => {
    mockUseWorkflowBackend.mockReturnValue({
      ...defaultBackend,
      view: "prd",
      workflowStatus: "prd",
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
});
