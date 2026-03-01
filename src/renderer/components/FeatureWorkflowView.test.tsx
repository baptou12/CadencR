import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureWorkflowView } from "./FeatureWorkflowView";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

const mockInvalidate = vi.fn();
const mockDeleteSession = vi.fn();
const mockUpdateFeatureStatus = vi.fn();

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
        useMutation: vi.fn(() => ({ mutate: mockUpdateFeatureStatus })),
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
        useMutation: vi.fn(() => ({ mutate: mockDeleteSession })),
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

vi.mock("@/hooks/useFeatureState", () => ({
  useFeatureState: vi.fn(() => ({
    featureStatus: "idle",
    workflowState: "idle",
    canStartPlan: true,
    canStartPrd: true,
    canStartExecute: false,
    canStartRisk: false,
    canStartReview: false,
    canStartQA: false,
    canStartBuild: false,
    isRunning: false,
    view: {},
    actions: {},
  })),
}));

vi.mock("@/hooks/useWorkflowAgents", () => ({
  useWorkflowAgents: vi.fn(() => ({
    sessionEntries: [],
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    handleSend: vi.fn(),
    plan: { status: "idle", blocks: [] },
    prd: { status: "idle", blocks: [] },
    execute: { status: "idle", blocks: [] },
    risk: { status: "idle", blocks: [] },
    review: { status: "idle", blocks: [] },
  })),
}));

vi.mock("@/hooks/useContextUsage", () => ({
  useContextUsage: vi.fn(() => ({})),
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
}));

vi.mock("@/hooks/useAgentChat", () => ({
  useAgentChat: vi.fn(() => ({
    handleSend: vi.fn(),
    handleStop: vi.fn(),
    handleResume: vi.fn(),
    handleAnswer: vi.fn(),
    handlePermissionDecision: vi.fn(),
    handlePlanApprove: vi.fn(),
    handlePlanRequestChanges: vi.fn(),
    handlePermissionModeToggle: vi.fn(),
  })),
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
