import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAgentChat, usePermissionMode } from "./useAgentChat";
import type { FeatureSession } from "./useFeatureAgentState";

const mockSubmitToolPermission = vi.fn();
const mockSubmitPlanApproval = vi.fn();
const mockStorePlanApproval = vi.fn();
const mockSubmitAnswers = vi.fn();
const mockResumeMutate = vi.fn().mockResolvedValue({});
const mockSetPermissionMode = vi.fn();

vi.mock("@/trpc", () => ({
  trpc: {
    agents: {
      submitToolPermission: {
        useMutation: vi.fn(() => ({ mutate: mockSubmitToolPermission })),
      },
      submitPlanApproval: {
        useMutation: vi.fn(() => ({ mutate: mockSubmitPlanApproval })),
      },
      storePlanApproval: {
        useMutation: vi.fn(() => ({ mutate: mockStorePlanApproval })),
      },
      submitAnswers: {
        useMutation: vi.fn(() => ({ mutate: mockSubmitAnswers })),
      },
      resume: {
        useMutation: vi.fn(() => ({ mutateAsync: mockResumeMutate })),
      },
      setPermissionMode: {
        useMutation: vi.fn(() => ({ mutate: mockSetPermissionMode })),
      },
    },
  },
}));

vi.mock("@/lib/parse-question-answers", () => ({
  parseQuestionAnswers: vi.fn((questions: unknown[], response: string) => ({
    "Test question?": response,
  })),
}));

const mockRefetch = vi.fn();

function makeSession(overrides: Partial<FeatureSession> = {}): FeatureSession {
  return {
    sessionDbId: 1,
    agentType: "plan",
    status: "paused",
    subprocessId: "sub-1",
    model: null,
    blocks: [],
    pendingQuestions: [{ question: "Test question?", options: [] }],
    hasFileChanges: false,
    resumable: false,
    claudeSessionId: "claude-session-1",
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

describe("useAgentChat", () => {
  beforeEach(() => {
    mockSubmitToolPermission.mockClear();
    mockSubmitPlanApproval.mockClear();
    mockStorePlanApproval.mockClear();
    mockSubmitAnswers.mockClear();
    mockResumeMutate.mockClear();
    mockRefetch.mockClear();
  });

  describe("handlePermissionDecision", () => {
    it("calls submitToolPermission mutation", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePermissionDecision("sub-1", "allow_once");
      });
      expect(mockSubmitToolPermission).toHaveBeenCalledWith({
        subprocessId: "sub-1",
        decision: "allow_once",
        feedback: undefined,
      });
    });

    it("does nothing when subprocessId is null", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePermissionDecision(null, "allow_once");
      });
      expect(mockSubmitToolPermission).not.toHaveBeenCalled();
    });

    it("passes feedback when provided", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePermissionDecision("sub-1", "deny", "Not allowed");
      });
      expect(mockSubmitToolPermission).toHaveBeenCalledWith({
        subprocessId: "sub-1",
        decision: "deny",
        feedback: "Not allowed",
      });
    });
  });

  describe("handlePlanApprove", () => {
    it("calls submitPlanApproval with approved=true", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePlanApprove("sub-1");
      });
      expect(mockSubmitPlanApproval).toHaveBeenCalledWith(
        { subprocessId: "sub-1", approved: true },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it("does nothing when subprocessId is null and no sessionDbId", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePlanApprove(null);
      });
      expect(mockSubmitPlanApproval).not.toHaveBeenCalled();
      expect(mockStorePlanApproval).not.toHaveBeenCalled();
    });

    it("stores approval in DB when subprocessId is null but sessionDbId is provided", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePlanApprove(null, 42);
      });
      expect(mockSubmitPlanApproval).not.toHaveBeenCalled();
      expect(mockStorePlanApproval).toHaveBeenCalledWith(
        { sessionDbId: 42, approved: true },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it("does not set planApprovalError when storing approval for paused agent", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePlanApprove(null, 42);
      });
      expect(result.current.planApprovalError).toBeNull();
    });
  });

  describe("handlePlanRequestChanges", () => {
    it("calls submitPlanApproval with approved=false and feedback", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePlanRequestChanges("sub-1", "Please fix X");
      });
      expect(mockSubmitPlanApproval).toHaveBeenCalledWith(
        { subprocessId: "sub-1", approved: false, feedback: "Please fix X" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it("stores rejection in DB when subprocessId is null but sessionDbId is provided", () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      act(() => {
        result.current.handlePlanRequestChanges(null, "Some feedback", 99);
      });
      expect(mockSubmitPlanApproval).not.toHaveBeenCalled();
      expect(mockStorePlanApproval).toHaveBeenCalledWith(
        { sessionDbId: 99, approved: false, feedback: "Some feedback" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });

  describe("handleAnswerSubmit", () => {
    it("does nothing when no pending questions", async () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      await act(async () => {
        await result.current.handleAnswerSubmit(
          makeSession({ pendingQuestions: [] }),
          "answer",
        );
      });
      expect(mockSubmitAnswers).not.toHaveBeenCalled();
    });

    it("submits answers when subprocessId is present", async () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      await act(async () => {
        await result.current.handleAnswerSubmit(makeSession({ subprocessId: "sub-1" }), "my answer");
      });
      expect(mockSubmitAnswers).toHaveBeenCalled();
    });

    it("resumes via claudeSessionId when no subprocess", async () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      await act(async () => {
        await result.current.handleAnswerSubmit(
          makeSession({ subprocessId: null, claudeSessionId: "claude-1" }),
          "my answer",
        );
      });
      expect(mockResumeMutate).toHaveBeenCalled();
    });

    it("does nothing when session is undefined", async () => {
      const { result } = renderHook(() =>
        useAgentChat({ featureId: 1, projectId: 1, refetch: mockRefetch }),
      );
      await act(async () => {
        await result.current.handleAnswerSubmit(undefined, "answer");
      });
      expect(mockSubmitAnswers).not.toHaveBeenCalled();
      expect(mockResumeMutate).not.toHaveBeenCalled();
    });
  });
});

describe("usePermissionMode", () => {
  beforeEach(() => {
    mockSetPermissionMode.mockClear();
  });

  it("initializes with acceptEdits by default", () => {
    const { result } = renderHook(() => usePermissionMode(undefined));
    expect(result.current.permissionMode).toBe("acceptEdits");
  });

  it("initializes from session permissionMode", () => {
    const session = makeSession({ permissionMode: "plan" });
    const { result } = renderHook(() => usePermissionMode(session));
    expect(result.current.permissionMode).toBe("plan");
  });

  it("toggles from acceptEdits to plan", () => {
    const session = makeSession({ permissionMode: "acceptEdits", sessionDbId: 5 });
    const { result } = renderHook(() => usePermissionMode(session));
    act(() => {
      result.current.handlePermissionModeToggle();
    });
    expect(result.current.permissionMode).toBe("plan");
    expect(mockSetPermissionMode).toHaveBeenCalledWith({ sessionId: 5, mode: "plan" });
  });

  it("toggles from plan to acceptEdits", () => {
    const session = makeSession({ permissionMode: "plan", sessionDbId: 5 });
    const { result } = renderHook(() => usePermissionMode(session));
    act(() => {
      result.current.handlePermissionModeToggle();
    });
    expect(result.current.permissionMode).toBe("acceptEdits");
  });
});
