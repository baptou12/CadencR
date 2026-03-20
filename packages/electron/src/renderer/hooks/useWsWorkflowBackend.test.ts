import { describe, it, expect } from "vitest";
import { findQueueItemId } from "./useWsWorkflowBackend";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { AgentSessionState } from "./useWorkflowWebSocket";

function makeEntry(overrides: Partial<FeatureSession>): FeatureSession {
  return {
    sessionDbId: 0,
    agentType: "execute",
    status: "running",
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

describe("findQueueItemId", () => {
  it("returns -1 for plan agents", () => {
    const entry = makeEntry({ agentType: "plan", sessionDbId: 1754 });
    expect(findQueueItemId(entry, [], new Map())).toBe(-1);
  });

  it("returns -2 for prd agents", () => {
    const entry = makeEntry({ agentType: "prd", sessionDbId: 42 });
    expect(findQueueItemId(entry, [], new Map())).toBe(-2);
  });

  it("finds item ID from activeAgents by sessionId", () => {
    const entry = makeEntry({ sessionDbId: 100 });
    const activeAgents = new Map<number, AgentSessionState>([
      [5, { sessionId: 100, blocks: [], streamingState: {} as never, status: "running", pendingPermission: null }],
    ]);
    expect(findQueueItemId(entry, [], activeAgents)).toBe(5);
  });

  it("finds item ID from queue by agent_session_id", () => {
    const entry = makeEntry({ sessionDbId: 200 });
    const queue = [{ id: 10, agent_session_id: 200 }] as never[];
    expect(findQueueItemId(entry, queue, new Map())).toBe(10);
  });

  it("falls back to sessionDbId when no match found", () => {
    const entry = makeEntry({ sessionDbId: 300 });
    expect(findQueueItemId(entry, [], new Map())).toBe(300);
  });
});
