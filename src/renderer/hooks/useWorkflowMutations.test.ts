import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowMutations } from "./useWorkflowMutations";
import type { FeatureSession } from "./useFeatureAgentState";

// All mutations
const mockEnsureWorktree = vi.fn().mockResolvedValue({});
const mockStartPlan = vi.fn().mockResolvedValue({});
const mockStartBrainstorm = vi.fn().mockResolvedValue({});
const mockStartExecute = vi.fn().mockResolvedValue({});
const mockStartRisk = vi.fn().mockResolvedValue({});
const mockStartReview = vi.fn().mockResolvedValue({});
const mockAddFixPhase = vi.fn().mockResolvedValue({});
const mockSubmitAnswers = vi.fn();
const mockStop = vi.fn().mockResolvedValue({});
const mockStopBySessionId = vi.fn().mockResolvedValue({});
const mockInterrupt = vi.fn().mockResolvedValue({});
const mockInterruptBySessionId = vi.fn().mockResolvedValue({});
const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
const mockResume = vi.fn().mockResolvedValue({});
const mockContinueExecute = vi.fn().mockResolvedValue({});
const mockStartWorkflowSession = vi.fn().mockResolvedValue({});

vi.mock("@/trpc", () => ({
  trpc: {
    agents: {
      ensureWorktree: { useMutation: vi.fn(() => ({ mutateAsync: mockEnsureWorktree, isLoading: false })) },
      startPlan: { useMutation: vi.fn(() => ({ mutateAsync: mockStartPlan, isLoading: false })) },
      startBrainstorm: { useMutation: vi.fn(() => ({ mutateAsync: mockStartBrainstorm, isLoading: false })) },
      startExecute: { useMutation: vi.fn(() => ({ mutateAsync: mockStartExecute, isLoading: false })) },
      startRisk: { useMutation: vi.fn(() => ({ mutateAsync: mockStartRisk, isLoading: false })) },
      startReview: { useMutation: vi.fn(() => ({ mutateAsync: mockStartReview, isLoading: false })) },
      addFixPhase: { useMutation: vi.fn(() => ({ mutateAsync: mockAddFixPhase, isLoading: false })) },
      submitAnswers: { useMutation: vi.fn(() => ({ mutate: mockSubmitAnswers })) },
      stop: { useMutation: vi.fn(() => ({ mutateAsync: mockStop })) },
      stopBySessionId: { useMutation: vi.fn(() => ({ mutateAsync: mockStopBySessionId })) },
      interrupt: { useMutation: vi.fn(() => ({ mutateAsync: mockInterrupt })) },
      interruptBySessionId: { useMutation: vi.fn(() => ({ mutateAsync: mockInterruptBySessionId })) },
      sendMessage: { useMutation: vi.fn(() => ({ mutateAsync: mockSendMessage })) },
      resume: { useMutation: vi.fn(() => ({ mutateAsync: mockResume })) },
      continueExecute: { useMutation: vi.fn(() => ({ mutateAsync: mockContinueExecute, isLoading: false })) },
      startWorkflowSession: { useMutation: vi.fn(() => ({ mutateAsync: mockStartWorkflowSession, isLoading: false })) },
    },
  },
}));

vi.mock("@/lib/parse-question-answers", () => ({
  parseQuestionAnswers: vi.fn(() => ({ "Test question?": "Test answer" })),
}));

const mockRefetch = vi.fn();
const mockGetDescription = vi.fn(() => "Feature description");

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
    resumable: true,
    claudeSessionId: "claude-1",
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

describe("useWorkflowMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDescription.mockReturnValue("Feature description");
  });

  it("handleStartPlanning calls ensureWorktree then startPlan", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartPlanning();
    expect(mockEnsureWorktree).toHaveBeenCalledWith({ featureId: 1, projectId: 1, description: "Feature description" });
    expect(mockStartPlan).toHaveBeenCalledWith({ featureId: 1, projectId: 1, description: "Feature description" });
  });

  it("handleStartPlanning does nothing when description is empty", async () => {
    mockGetDescription.mockReturnValue("   ");
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartPlanning();
    expect(mockEnsureWorktree).not.toHaveBeenCalled();
  });

  it("handleStartBrainstorming calls startBrainstorm", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartBrainstorming();
    expect(mockStartBrainstorm).toHaveBeenCalled();
  });

  it("handleStartBuilding calls startExecute", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartBuilding();
    expect(mockStartExecute).toHaveBeenCalledWith({ featureId: 1, projectId: 1 });
  });

  it("handleStartRisk calls startRisk", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartRisk();
    expect(mockStartRisk).toHaveBeenCalledWith({ featureId: 1, projectId: 1 });
  });

  it("handleStartReview calls startReview", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartReview();
    expect(mockStartReview).toHaveBeenCalledWith({ featureId: 1, projectId: 1 });
  });

  it("handleQuestionResponse submits answers when subprocessId is present", async () => {
    const session = makeSession({
      subprocessId: "sub-1",
      pendingQuestions: [{ question: "Test question?", options: [] }],
    });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleQuestionResponse(session, "my answer");
    expect(mockSubmitAnswers).toHaveBeenCalled();
  });

  it("handleQuestionResponse resumes session when no subprocess", async () => {
    const session = makeSession({
      subprocessId: null,
      claudeSessionId: "claude-1",
      pendingQuestions: [{ question: "Test question?", options: [] }],
    });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleQuestionResponse(session, "answer");
    expect(mockResume).toHaveBeenCalled();
  });

  it("handleAgentStop calls stop mutation when subprocess exists", async () => {
    const session = makeSession({ agentType: "plan", subprocessId: "sub-1", status: "running" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentStop("plan");
    expect(mockStop).toHaveBeenCalledWith({ id: "sub-1" });
  });

  it("handleAgentStop does nothing when no matching session", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentStop("plan");
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("handleContinueBuild calls continueExecute", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleContinueBuild(42);
    expect(mockContinueExecute).toHaveBeenCalledWith({ sessionDbId: 42 });
  });

  it("handleAddFixPhase calls addFixPhase with fix description", async () => {
    const blocks = [{ id: "1", type: "text" as const, content: "Fix this bug" }];
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAddFixPhase(blocks);
    expect(mockAddFixPhase).toHaveBeenCalledWith(
      expect.objectContaining({ featureId: 1 }),
    );
  });

  it("handleStartWorkflowSession calls startWorkflowSession", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartWorkflowSession();
    expect(mockStartWorkflowSession).toHaveBeenCalledWith({ featureId: 1, projectId: 1 });
  });

  it("handleMarkSessionDone calls stopBySessionId", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleMarkSessionDone(5);
    expect(mockStopBySessionId).toHaveBeenCalledWith({ sessionId: 5 });
  });

  it("exposes loading states", () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    expect(result.current.isStartingPlan).toBe(false);
    expect(result.current.isStartingBrainstorm).toBe(false);
    expect(result.current.isStartingExecute).toBe(false);
    expect(result.current.isStartingRisk).toBe(false);
    expect(result.current.isStartingReview).toBe(false);
  });
});
