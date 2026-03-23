import { describe, it, expect } from "vitest";
import { findQueueItemId, buildSessionEntries } from "./useWsWorkflowBackend";
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

function makeAgentState(overrides?: Partial<AgentSessionState>): AgentSessionState {
  return {
    sessionId: 1,
    agentType: "execute",
    blocks: [],
    streamingState: { activeTextIndex: null, activeThinkingIndex: null, toolCalls: new Map() } as never,
    status: "running",
    pendingPermission: null,
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
    historyLoaded: false,
    claudeSessionId: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200_000,
    hasFileChanges: false,
    ...overrides,
  };
}

describe("buildSessionEntries", () => {
  it("sets pendingPlanApproval on planSession when workflowStatus is plan_approval", () => {
    const planAgent = makeAgentState({ sessionId: 10, status: "paused" });
    const { planSession } = buildSessionEntries([], new Map(), planAgent, null, "plan_approval");

    expect(planSession).not.toBeNull();
    expect(planSession!.pendingPlanApproval).toEqual({});
  });

  it("does not set pendingPlanApproval on planSession when workflowStatus is not plan_approval", () => {
    const planAgent = makeAgentState({ sessionId: 10, status: "paused" });
    const { planSession } = buildSessionEntries([], new Map(), planAgent, null, "planning");

    expect(planSession).not.toBeNull();
    expect(planSession!.pendingPlanApproval).toBeNull();
  });

  it("sets pendingPlanApproval on prdSession when workflowStatus is prd and prdAgent is paused", () => {
    const prdAgent = makeAgentState({ sessionId: 20, status: "paused" });
    const { prdSession } = buildSessionEntries([], new Map(), null, prdAgent, "prd");

    expect(prdSession).not.toBeNull();
    expect(prdSession!.pendingPlanApproval).toEqual({});
  });

  it("does not set pendingPlanApproval on prdSession when prdAgent is not paused", () => {
    const prdAgent = makeAgentState({ sessionId: 20, status: "running" });
    const { prdSession } = buildSessionEntries([], new Map(), null, prdAgent, "prd");

    expect(prdSession).not.toBeNull();
    expect(prdSession!.pendingPlanApproval).toBeNull();
  });

  it("does not set pendingPlanApproval on prdSession when workflowStatus is not prd", () => {
    const prdAgent = makeAgentState({ sessionId: 20, status: "paused" });
    const { prdSession } = buildSessionEntries([], new Map(), null, prdAgent, "planning");

    expect(prdSession).not.toBeNull();
    expect(prdSession!.pendingPlanApproval).toBeNull();
  });

  it("includes running queue item with matching activeAgent in sessions", () => {
    const queue = [
      { id: 10, status: "running" as const, item_type: "execute", phase_id: 1, phase_title: "Phase 1", order_index: 0, group_index: 0, agent_session_id: 88, result: null },
    ];
    const agents = new Map<number, AgentSessionState>([
      [10, makeAgentState({ sessionId: 88, status: "running" })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, null, null, "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionDbId).toBe(88);
    expect(sessions[0].status).toBe("running");
    expect(sessions[0].phaseTitle).toBe("Phase 1");
  });

  it("queue_update before item_started: agent appears in sessions after both arrive", () => {
    // Simulates the fix where queue_update is sent before advance/item_started
    // so the frontend has the queue item when item_started arrives.
    const queue = [
      { id: 10, status: "running" as const, item_type: "execute", phase_id: 1, phase_title: "Setup", order_index: 0, group_index: 0, agent_session_id: 42, result: null },
    ];
    const agents = new Map<number, AgentSessionState>([
      [10, makeAgentState({ sessionId: 42, status: "running" })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, null, null, "building");

    // The agent should appear because its queue item exists and has a matching activeAgent
    const setupSession = sessions.find((s) => s.phaseTitle === "Setup");
    expect(setupSession).toBeDefined();
    expect(setupSession!.sessionDbId).toBe(42);
  });

  it("passes hasFileChanges from agentState to session entry via queue item", () => {
    const queue = [
      { id: 10, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 88, result: null },
    ];
    const agents = new Map<number, AgentSessionState>([
      [10, makeAgentState({ sessionId: 88, status: "completed", hasFileChanges: true })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, null, null, "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].hasFileChanges).toBe(true);
  });

  it("defaults hasFileChanges to false when agentState has no file changes", () => {
    const queue = [
      { id: 11, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 89, result: null },
    ];
    const agents = new Map<number, AgentSessionState>([
      [11, makeAgentState({ sessionId: 89, status: "completed", hasFileChanges: false })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, null, null, "building");

    expect(sessions[0].hasFileChanges).toBe(false);
  });

  it("defaults hasFileChanges to false when no agentState exists for queue item", () => {
    const queue = [
      { id: 12, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 90, result: null },
    ];
    const { sessions } = buildSessionEntries(queue, new Map(), null, null, "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].hasFileChanges).toBe(false);
  });

  it("renders multiple session agents with unique negative keys using agentType from state", () => {
    const agents = new Map<number, AgentSessionState>([
      [-1050, makeAgentState({ sessionId: 50, agentType: "session", status: "completed" })],
      [-1051, makeAgentState({ sessionId: 51, agentType: "session", status: "paused" })],
      [-1052, makeAgentState({ sessionId: 52, agentType: "risk", status: "completed" })],
    ]);
    const { sessions } = buildSessionEntries([], agents, null, null, "building");

    expect(sessions).toHaveLength(3);
    expect(sessions.map(s => s.agentType)).toEqual(["session", "session", "risk"]);
    expect(sessions.map(s => s.sessionDbId)).toEqual([50, 51, 52]);
  });
});
