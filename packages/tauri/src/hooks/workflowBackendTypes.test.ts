import { describe, it, expect } from "vitest";
import { deriveViewState } from "./workflowBackendTypes";
import type { FeatureSession } from "./useFeatureAgentState";
import type { WorkflowStatus } from "./useWorkflowWebSocket";

function makeSession(overrides?: Partial<FeatureSession>): FeatureSession {
  return {
    sessionDbId: 1,
    agentType: "execute",
    status: "completed",
    blocks: [],
    pendingPermission: null,
    pendingQuestions: null,
    hasFileChanges: false,
    resumable: false,
    phaseId: null,
    phaseTitle: null,
    subprocessId: null,
    model: null,
    claudeSessionId: null,
    runId: null,
    todos: null,
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200000,
    wasCompacted: false,
    draftPrompt: null,
    ...overrides,
  };
}

describe("deriveViewState", () => {
  describe("no sessions", () => {
    it("idle → plan-input", () => {
      expect(deriveViewState("idle", [])).toBe("plan-input");
    });

    it("planning → planning", () => {
      expect(deriveViewState("planning", [])).toBe("planning");
    });

    it("prd → prd", () => {
      expect(deriveViewState("prd", [])).toBe("prd");
    });

    it("plan_approval → plan-approval", () => {
      expect(deriveViewState("plan_approval", [])).toBe("plan-approval");
    });

    it("building → agents-active", () => {
      expect(deriveViewState("building", [])).toBe("agents-active");
    });

    it("paused → paused", () => {
      expect(deriveViewState("paused", [])).toBe("paused");
    });

    it("completed → done", () => {
      expect(deriveViewState("completed", [])).toBe("done");
    });

    it("error → plan-input", () => {
      expect(deriveViewState("error", [])).toBe("plan-input");
    });
  });

  describe("with existing sessions — never shows plan-input", () => {
    const sessions = [makeSession()];

    it("idle with sessions → agents-active (not plan-input)", () => {
      expect(deriveViewState("idle", sessions)).toBe("agents-active");
    });

    it("paused with sessions → agents-active (not paused)", () => {
      expect(deriveViewState("paused", sessions)).toBe("agents-active");
    });

    it("error with sessions → agents-active", () => {
      expect(deriveViewState("error", sessions)).toBe("agents-active");
    });

    it("unknown status with sessions → agents-active", () => {
      expect(deriveViewState("unknown_status" as WorkflowStatus, sessions)).toBe("agents-active");
    });

    it("planning with sessions still returns planning", () => {
      expect(deriveViewState("planning", sessions)).toBe("planning");
    });

    it("completed with sessions still returns done", () => {
      expect(deriveViewState("completed", sessions)).toBe("done");
    });
  });
});
