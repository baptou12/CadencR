import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowAgents } from "./useWorkflowAgents";
import type { FeatureSession } from "./useFeatureAgentState";

// Mock useFeatureAgentState
const mockSessions: FeatureSession[] = [];
const mockRefetch = vi.fn();

vi.mock("@/hooks/useFeatureAgentState", () => ({
  useFeatureAgentState: vi.fn(() => ({
    sessions: mockSessions,
    isLoading: false,
    refetch: mockRefetch,
  })),
}));

// Mock useWorkflowMutations
const mockHandlers = {
  handleQuestionResponse: vi.fn(),
  handleContinueBuild: vi.fn().mockResolvedValue(undefined),
  handleAddFixPhase: vi.fn().mockResolvedValue(undefined),
  handleStartPlanning: vi.fn().mockResolvedValue(undefined),
  handleStartPrd: vi.fn().mockResolvedValue(undefined),
  handleStartBuilding: vi.fn().mockResolvedValue(undefined),
  handleStartRisk: vi.fn().mockResolvedValue(undefined),
  handleStartReview: vi.fn().mockResolvedValue(undefined),
  handleResume: vi.fn().mockResolvedValue(undefined),
  handleAgentSend: vi.fn().mockResolvedValue(undefined),
  handleAgentStop: vi.fn().mockResolvedValue(undefined),
  sendToExecuteSubprocess: vi.fn().mockResolvedValue(undefined),
  interruptExecuteSubprocess: vi.fn().mockResolvedValue(undefined),
  handleFixImmediately: vi.fn().mockResolvedValue(undefined),
  handleStartWorkflowSession: vi.fn().mockResolvedValue(undefined),
  handleMarkSessionDone: vi.fn().mockResolvedValue(undefined),
  isPreparingWorktree: false,
  isStartingPlan: false,
  isStartingPrd: false,
  isStartingExecute: false,
  isStartingRisk: false,
  isStartingReview: false,
  isAddingFixPhase: false,
  isStartingFix: false,
  isContinuingBuild: false,
  isStartingWorkflowSession: false,
};

vi.mock("@/hooks/useWorkflowMutations", () => ({
  useWorkflowMutations: vi.fn(() => mockHandlers),
}));

function makeSession(overrides: Partial<FeatureSession> = {}): FeatureSession {
  return {
    sessionDbId: 1,
    agentType: "plan",
    status: "idle",
    subprocessId: null,
    model: null,
    blocks: [],
    pendingQuestions: null,
    hasFileChanges: false,
    resumable: false,
    claudeSessionId: null,
    runId: null,
    phaseId: null,
    phaseTitle: null,
    todos: null,
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    pendingPermission: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200000,
    wasCompacted: false,
    draftPrompt: null,
    ...overrides,
  };
}

describe("useWorkflowAgents", () => {
  beforeEach(() => {
    mockSessions.length = 0;
    mockRefetch.mockClear();
    vi.clearAllMocks();
  });

  it("returns idle status for all agents when no sessions", () => {
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.plan.status).toBe("idle");
    expect(result.current.execute.status).toBe("idle");
    expect(result.current.risk.status).toBe("idle");
    expect(result.current.review.status).toBe("idle");
  });

  it("reflects plan session status", () => {
    mockSessions.push(makeSession({ agentType: "plan", status: "running", subprocessId: "sub-1" }));
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.plan.status).toBe("running");
  });

  it("hasAnyAgentOutput is false when sessions are empty", () => {
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.hasAnyAgentOutput).toBe(false);
  });

  it("hasAnyAgentOutput is true when a non-execute session with blocks exists", () => {
    mockSessions.push(
      makeSession({
        agentType: "plan",
        status: "completed",
        subprocessId: null,
        blocks: [{ id: "1", type: "text", content: "output" }],
      }),
    );
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.hasAnyAgentOutput).toBe(true);
  });

  it("noAgentsRunning is true when no sessions running", () => {
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.noAgentsRunning).toBe(true);
  });

  it("noAgentsRunning is false when a session is running", () => {
    mockSessions.push(makeSession({ status: "running" }));
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.noAgentsRunning).toBe(false);
  });

  it("canContinueBuild is true when there's a waiting orchestrator session", () => {
    mockSessions.push(
      makeSession({ agentType: "execute", runId: null, status: "paused", subprocessId: null }),
    );
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.canContinueBuild).toBe(true);
  });

  it("executeStatus is running when any execute session is running", () => {
    mockSessions.push(
      makeSession({ agentType: "execute", status: "running", subprocessId: "sub-1" }),
    );
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.execute.status).toBe("running");
  });

  it("executeStatus is completed when all execute sessions are completed", () => {
    mockSessions.push(
      makeSession({ agentType: "execute", status: "completed", subprocessId: "sub-1" }),
    );
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.execute.status).toBe("completed");
  });

  it("exposes loading states from mutations", () => {
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.isStartingPlan).toBe(false);
    expect(result.current.isStartingExecute).toBe(false);
    expect(result.current.isContinuingBuild).toBe(false);
  });

  it("reviewVerdict is null when review session is not completed", () => {
    mockSessions.push(makeSession({ agentType: "review", status: "running" }));
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.reviewVerdict).toBeNull();
  });

  it("reviewVerdict is null when review completed without fix phases", () => {
    mockSessions.push(makeSession({ agentType: "review", status: "completed" }));
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.reviewVerdict).toBeNull();
  });

  it("reviewVerdict is changes_requested when review called finalize_phases", () => {
    mockSessions.push(makeSession({
      agentType: "review",
      status: "completed",
      blocks: [{ id: "1", type: "tool_call", content: "", toolName: "finalize_phases" }],
    }));
    const { result } = renderHook(() =>
      useWorkflowAgents({ featureId: 1, projectId: 1, getDescription: () => "desc" }),
    );
    expect(result.current.reviewVerdict).toBe("changes_requested");
  });
});
