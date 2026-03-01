import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFeatureAgentState } from "./useFeatureAgentState";

const mockRefetch = vi.fn();
const mockUseQuery = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    sessions: {
      getFeatureAgentState: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}));

type AgentEventListener = (data: unknown) => void;

describe("useFeatureAgentState", () => {
  let onAgentEventListener: AgentEventListener | null = null;

  beforeEach(() => {
    onAgentEventListener = null;
    mockRefetch.mockClear();
    mockUseQuery.mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      refetch: mockRefetch,
    });

    Object.defineProperty(window, "api", {
      value: {
        onAgentEvent: vi.fn((cb: AgentEventListener) => {
          onAgentEventListener = cb;
          return cb;
        }),
        offAgentEvent: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  it("returns empty sessions when query data is empty", () => {
    const { result } = renderHook(() => useFeatureAgentState(1));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("maps session data correctly", () => {
    mockUseQuery.mockReturnValue({
      data: {
        sessions: [
          {
            sessionDbId: 1,
            agentType: "plan",
            status: "completed",
            subprocessId: null,
            model: "claude-opus-4-5",
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
            inputTokens: 100,
            outputTokens: 50,
            contextWindow: 200000,
            wasCompacted: false,
          },
        ],
      },
      isLoading: false,
      refetch: mockRefetch,
    });

    const { result } = renderHook(() => useFeatureAgentState(1));
    expect(result.current.sessions).toHaveLength(1);
    const session = result.current.sessions[0];
    expect(session.sessionDbId).toBe(1);
    expect(session.agentType).toBe("plan");
    expect(session.status).toBe("completed");
    expect(session.model).toBe("claude-opus-4-5");
    expect(session.inputTokens).toBe(100);
  });

  it("maps status=waiting to paused", () => {
    mockUseQuery.mockReturnValue({
      data: {
        sessions: [
          {
            sessionDbId: 1,
            agentType: "execute",
            status: "waiting",
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
          },
        ],
      },
      isLoading: false,
      refetch: mockRefetch,
    });

    const { result } = renderHook(() => useFeatureAgentState(1));
    expect(result.current.sessions[0].status).toBe("paused");
  });

  it("isLoading is true when query is loading", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, refetch: mockRefetch });
    const { result } = renderHook(() => useFeatureAgentState(1));
    expect(result.current.isLoading).toBe(true);
  });

  it("triggers refetch on agent_done event", () => {
    const { result } = renderHook(() => useFeatureAgentState(1));
    expect(result.current.refetch).toBeDefined();

    // Simulate agent_done event
    onAgentEventListener?.({ event: { type: "agent_done" } });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("triggers refetch on result event", () => {
    renderHook(() => useFeatureAgentState(1));
    onAgentEventListener?.({ event: { type: "result" } });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("does not trigger refetch on non-terminal events", () => {
    renderHook(() => useFeatureAgentState(1));
    onAgentEventListener?.({ event: { type: "text", text: "hello" } });
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("parses multi-question format from pendingQuestions", () => {
    const pendingQuestions = {
      questions: [
        { question: "What is your name?", options: ["Alice", "Bob"] },
        { question: "Pick a color?", options: [{ label: "Red" }, { label: "Blue" }] },
      ],
    };
    mockUseQuery.mockReturnValue({
      data: {
        sessions: [
          {
            sessionDbId: 1,
            agentType: "plan",
            status: "paused",
            subprocessId: "sub-1",
            model: null,
            blocks: [],
            pendingQuestions,
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
          },
        ],
      },
      isLoading: false,
      refetch: mockRefetch,
    });

    const { result } = renderHook(() => useFeatureAgentState(1));
    const session = result.current.sessions[0];
    expect(session.pendingQuestions).toHaveLength(2);
    expect(session.pendingQuestions![0].question).toBe("What is your name?");
    expect(session.pendingQuestions![0].options).toHaveLength(2);
  });

  it("parses single-question format from pendingQuestions", () => {
    const pendingQuestions = {
      question: "Are you sure?",
      options: ["Yes", "No"],
    };
    mockUseQuery.mockReturnValue({
      data: {
        sessions: [
          {
            sessionDbId: 1,
            agentType: "plan",
            status: "paused",
            subprocessId: "sub-1",
            model: null,
            blocks: [],
            pendingQuestions,
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
          },
        ],
      },
      isLoading: false,
      refetch: mockRefetch,
    });

    const { result } = renderHook(() => useFeatureAgentState(1));
    const session = result.current.sessions[0];
    expect(session.pendingQuestions).toHaveLength(1);
    expect(session.pendingQuestions![0].question).toBe("Are you sure?");
  });
});
