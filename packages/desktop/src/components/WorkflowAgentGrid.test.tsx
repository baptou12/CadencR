import { render } from "@/test-utils";
import type { AgentSessionProps } from "@/components/agent-session";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { WorkflowBackend } from "@/hooks/workflowBackendTypes";
import type { TodoItem } from "@/types/agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowAgentGrid } from "./WorkflowAgentGrid";

const { MockAgentSession } = vi.hoisted(() => ({
  MockAgentSession: vi.fn((_props: unknown) => null),
}));

vi.mock("@/components/agent-session", () => ({
  AgentSession: MockAgentSession,
  AGENT_LABELS: { execute: "Execute" },
}));

function makeSession(todos: TodoItem[] | null): FeatureSession {
  return {
    sessionDbId: 42,
    agentType: "execute",
    status: "running",
    subprocessId: null,
    model: null,
    blocks: [],
    pendingQuestions: null,
    hasFileChanges: false,
    resumable: false,
    runtimeProvider: null,
    runtimeSessionId: null,
    runId: null,
    phaseId: null,
    phaseTitle: null,
    todos,
    permissionMode: "default",
    pendingPlanApproval: null,
    pendingPermission: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: null,
    wasCompacted: false,
    draftPrompt: null,
    hasMore: false,
    oldestMessageId: null,
  };
}

function makeBackend(session: FeatureSession): WorkflowBackend {
  return {
    workflowStatus: "idle",
    sessionEntries: [session],
    planSession: null,
    prdSession: null,
    queue: null,
    autonomyLevel: 3,
    error: null,
    clearError: vi.fn(),
    hasAnyAgentOutput: true,
    noAgentsRunning: false,
    view: "agents-active",
    isLoading: false,
    actions: {
      canStartPlan: false,
      canStartPrd: false,
      canStartBuild: false,
      canStartRisk: false,
      canStartReview: false,
      canStartWorkflowSession: false,
      canStartRefine: false,
      canStartRetro: false,
    },
    isStartingPlan: false,
    isStartingPrd: false,
    isStartingExecute: false,
    isStartingRisk: false,
    isStartingReview: false,
    isStartingRetro: false,
    isContinuingBuild: false,
    isStartingWorkflowSession: false,
    isStartingRefinePlan: false,
    canContinueBuild: false,
    executeWaitingNextStep: null,
    executeStatus: "running",
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
}

function renderGrid(backend: WorkflowBackend, agentVisible: boolean): void {
  render(
    <WorkflowAgentGrid
      backend={backend}
      featureId={1}
      projectId={1}
      agentVisible={agentVisible}
      openAgent={null}
      setOpenAgent={vi.fn()}
      maximizedAgent={null}
      setMaximizedAgent={vi.fn()}
      setAgentRef={vi.fn()}
      agentsWithQuestions={0}
      contextUsageMap={new Map()}
      resolveModel={() => "model"}
      resolveProvider={() => "provider"}
      handleModelChange={vi.fn()}
      handleProviderChange={vi.fn()}
      resolveModelThinkingEffort={() => undefined}
      setModelThinkingEffort={vi.fn()}
      handleDeleteAgent={vi.fn()}
      onViewDiff={vi.fn()}
      slashCommands={[]}
      slashCommandsLoading={false}
    />,
  );
}

function lastAgentSessionProps(): AgentSessionProps {
  const call = MockAgentSession.mock.calls.at(-1);
  if (!call) throw new Error("AgentSession was not rendered");
  return call[0] as AgentSessionProps;
}

describe("WorkflowAgentGrid", () => {
  beforeEach(() => {
    MockAgentSession.mockClear();
  });

  it("passes todos when the agent tab is visible", () => {
    const todos: TodoItem[] = [{ content: "Do x", status: "pending", activeForm: "Doing x" }];

    renderGrid(makeBackend(makeSession(todos)), true);

    expect(lastAgentSessionProps().todos).toBe(todos);
  });

  it("passes null todos when the agent tab is hidden", () => {
    const todos: TodoItem[] = [{ content: "Do x", status: "pending", activeForm: "Doing x" }];
    renderGrid(makeBackend(makeSession(todos)), false);

    expect(lastAgentSessionProps().todos).toBeNull();
  });
});
