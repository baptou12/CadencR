import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkflowMutations } from "./useWorkflowMutations";
import type { FeatureSession } from "./useFeatureAgentState";

// All mutations
const mockEnsureWorktree = vi.fn().mockResolvedValue({});
const mockStartPlan = vi.fn().mockResolvedValue({});
const mockStartPrd = vi.fn().mockResolvedValue({});
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
      startPrd: { useMutation: vi.fn(() => ({ mutateAsync: mockStartPrd, isLoading: false })) },
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
      startRefinePlan: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isLoading: false })) },
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

  it("handleStartPrd calls startPrd", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleStartPrd();
    expect(mockStartPrd).toHaveBeenCalled();
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

  it("handleAgentStop calls stop mutation with the session's subprocessId", async () => {
    const session = makeSession({ agentType: "plan", subprocessId: "sub-1", status: "running" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentStop(session);
    expect(mockStop).toHaveBeenCalledWith({ id: "sub-1" });
  });

  it("handleAgentStop falls back to stopBySessionId when no subprocessId", async () => {
    const session = makeSession({ agentType: "plan", subprocessId: null, sessionDbId: 7 });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentStop(session);
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockStopBySessionId).toHaveBeenCalledWith({ sessionId: 7 });
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
    await result.current.handleStartWorkflowSession("help me build this");
    expect(mockStartWorkflowSession).toHaveBeenCalledWith({ featureId: 1, projectId: 1, prompt: "help me build this" });
  });

  it("handleMarkSessionDone calls stopBySessionId", async () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleMarkSessionDone(5);
    expect(mockStopBySessionId).toHaveBeenCalledWith({ sessionId: 5 });
  });

  // --- handleAgentSend tests ---

  it("handleAgentSend sends to the specific session's subprocess", async () => {
    const session = makeSession({ subprocessId: "sub-1", status: "running" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentSend(session, "hello");
    expect(mockSendMessage).toHaveBeenCalledWith({ id: "sub-1", message: "hello", images: undefined });
  });

  it("handleAgentSend targets the passed session, not an errored one of the same type", async () => {
    const erroredSession = makeSession({ sessionDbId: 1, subprocessId: "sub-old", status: "error", claudeSessionId: "old" });
    const activeSession = makeSession({ sessionDbId: 2, subprocessId: "sub-new", status: "running", claudeSessionId: "new" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [erroredSession, activeSession], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    // Pass the active session directly — this is the key fix
    await result.current.handleAgentSend(activeSession, "hello");
    expect(mockSendMessage).toHaveBeenCalledWith({ id: "sub-new", message: "hello", images: undefined });
    expect(mockSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ id: "sub-old" }));
  });

  it("handleAgentSend falls back to resume when no subprocessId", async () => {
    const session = makeSession({ sessionDbId: 5, subprocessId: null, claudeSessionId: "claude-5" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [session], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentSend(session, "resume me");
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockResume).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "claude-5",
      originalSessionDbId: 5,
      prompt: "resume me",
    }));
  });

  it("handleAgentSend resumes the correct session, not an errored one", async () => {
    const erroredSession = makeSession({ sessionDbId: 1, subprocessId: null, claudeSessionId: "old", status: "error" });
    const activeSession = makeSession({ sessionDbId: 2, subprocessId: null, claudeSessionId: "new", status: "completed" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [erroredSession, activeSession], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentSend(activeSession, "continue");
    expect(mockResume).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "new",
      originalSessionDbId: 2,
    }));
  });

  it("handleAgentStop targets the specific session passed, not another of same type", async () => {
    const erroredSession = makeSession({ sessionDbId: 1, subprocessId: "sub-old", status: "error" });
    const runningSession = makeSession({ sessionDbId: 2, subprocessId: "sub-new", status: "running" });
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [erroredSession, runningSession], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    await result.current.handleAgentStop(runningSession);
    expect(mockStop).toHaveBeenCalledWith({ id: "sub-new" });
    expect(mockStop).not.toHaveBeenCalledWith({ id: "sub-old" });
  });

  it("exposes loading states", () => {
    const { result } = renderHook(() =>
      useWorkflowMutations({ featureId: 1, projectId: 1, sessions: [], refetch: mockRefetch, getDescription: mockGetDescription }),
    );
    expect(result.current.isStartingPlan).toBe(false);
    expect(result.current.isStartingPrd).toBe(false);
    expect(result.current.isStartingExecute).toBe(false);
    expect(result.current.isStartingRisk).toBe(false);
    expect(result.current.isStartingReview).toBe(false);
  });
});
