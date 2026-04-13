import { describe, it, expect } from "vitest";
import { findSlotKey, buildSessionEntries } from "./useWsWorkflowBackend";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { AgentSessionState } from "@/types/workflow";

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
    runtimeSessionId: null,
    runId: null,
    todos: null,
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200000,
    wasCompacted: false,
    draftPrompt: null,
    hasMore: false,
    oldestMessageId: null,
    ...overrides,
  };
}

describe("findSlotKey", () => {
  it("returns plan key for plan agents", () => {
    const entry = makeEntry({ agentType: "plan", sessionDbId: 1754 });
    expect(findSlotKey(entry, [], new Map())).toBe("plan");
  });

  it("returns prd key for prd agents", () => {
    const entry = makeEntry({ agentType: "prd", sessionDbId: 42 });
    expect(findSlotKey(entry, [], new Map())).toBe("prd");
  });

  it("finds slot key from agents by sessionId", () => {
    const entry = makeEntry({ sessionDbId: 100 });
    const agents = new Map<string, AgentSessionState>([
      ["qi:5", { sessionId: 100, blocks: [], streamingState: {} as never, status: "running", pendingPermission: null, agentType: "execute", pendingQuestions: [], pendingQuestionToolInput: {}, pendingQuestionRequestId: "", historyLoaded: false, runtimeSessionId: null, inputTokens: 0, outputTokens: 0, contextWindow: 0, hasFileChanges: false }],
    ]);
    expect(findSlotKey(entry, [], agents)).toBe("qi:5");
  });

  it("finds slot key from queue by agent_session_id", () => {
    const entry = makeEntry({ sessionDbId: 200 });
    const queue = [{ id: 10, agent_session_id: 200 }] as never[];
    expect(findSlotKey(entry, queue, new Map())).toBe("qi:10");
  });

  it("falls back to session:sessionDbId when no match found", () => {
    const entry = makeEntry({ sessionDbId: 300 });
    expect(findSlotKey(entry, [], new Map())).toBe("session:300");
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
    runtimeSessionId: null,
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
    const agents = new Map<string, AgentSessionState>([["plan", planAgent]]);
    const { planSession } = buildSessionEntries([], agents, "plan_approval");

    expect(planSession).not.toBeNull();
    expect(planSession!.pendingPlanApproval).toEqual({});
  });

  it("does not set pendingPlanApproval on planSession when workflowStatus is not plan_approval", () => {
    const planAgent = makeAgentState({ sessionId: 10, status: "paused" });
    const agents = new Map<string, AgentSessionState>([["plan", planAgent]]);
    const { planSession } = buildSessionEntries([], agents, "planning");

    expect(planSession).not.toBeNull();
    expect(planSession!.pendingPlanApproval).toBeNull();
  });

  it("sets pendingPlanApproval on prdSession when workflowStatus is prd and prdAgent is paused", () => {
    const prdAgent = makeAgentState({ sessionId: 20, status: "paused" });
    const agents = new Map<string, AgentSessionState>([["prd", prdAgent]]);
    const { prdSession } = buildSessionEntries([], agents, "prd");

    expect(prdSession).not.toBeNull();
    expect(prdSession!.pendingPlanApproval).toEqual({});
  });

  it("does not set pendingPlanApproval on prdSession when prdAgent is not paused", () => {
    const prdAgent = makeAgentState({ sessionId: 20, status: "running" });
    const agents = new Map<string, AgentSessionState>([["prd", prdAgent]]);
    const { prdSession } = buildSessionEntries([], agents, "prd");

    expect(prdSession).not.toBeNull();
    expect(prdSession!.pendingPlanApproval).toBeNull();
  });

  it("does not set pendingPlanApproval on prdSession when workflowStatus is not prd", () => {
    const prdAgent = makeAgentState({ sessionId: 20, status: "paused" });
    const agents = new Map<string, AgentSessionState>([["prd", prdAgent]]);
    const { prdSession } = buildSessionEntries([], agents, "planning");

    expect(prdSession).not.toBeNull();
    expect(prdSession!.pendingPlanApproval).toBeNull();
  });

  it("includes running queue item with matching agent in sessions", () => {
    const queue = [
      { id: 10, status: "running" as const, item_type: "execute", phase_id: 1, phase_title: "Phase 1", order_index: 0, group_index: 0, agent_session_id: 88, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({ sessionId: 88, status: "running" })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionDbId).toBe(88);
    expect(sessions[0].status).toBe("running");
    expect(sessions[0].phaseTitle).toBe("Phase 1");
  });

  it("queue_update before item_started: agent appears in sessions after both arrive", () => {
    const queue = [
      { id: 10, status: "running" as const, item_type: "execute", phase_id: 1, phase_title: "Setup", order_index: 0, group_index: 0, agent_session_id: 42, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({ sessionId: 42, status: "running" })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "building");

    const setupSession = sessions.find((s) => s.phaseTitle === "Setup");
    expect(setupSession).toBeDefined();
    expect(setupSession!.sessionDbId).toBe(42);
  });

  it("passes hasFileChanges from agentState to session entry via queue item", () => {
    const queue = [
      { id: 10, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 88, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({ sessionId: 88, status: "completed", hasFileChanges: true })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].hasFileChanges).toBe(true);
  });

  it("defaults hasFileChanges to false when agentState has no file changes", () => {
    const queue = [
      { id: 11, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 89, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:11", makeAgentState({ sessionId: 89, status: "completed", hasFileChanges: false })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "building");

    expect(sessions[0].hasFileChanges).toBe(false);
  });

  it("defaults hasFileChanges to false when no agentState exists for queue item", () => {
    const queue = [
      { id: 12, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 90, result: null },
    ];
    const { sessions } = buildSessionEntries(queue, new Map(), "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].hasFileChanges).toBe(false);
  });

  it("sessions with paused/running status and empty blocks indicate history is needed", () => {
    const queue = [
      { id: 10, status: "paused" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 88, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({ sessionId: 88, status: "paused", blocks: [] })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "paused");

    const needsHistory = sessions.some(
      (s) => (s.status === "paused" || s.status === "running") && s.blocks.length === 0,
    );
    expect(needsHistory).toBe(true);
  });

  it("sessions with blocks loaded do not indicate history is needed", () => {
    const queue = [
      { id: 10, status: "paused" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 88, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({
        sessionId: 88,
        status: "paused",
        blocks: [{ id: "1", type: "text", content: "hello" }] as never[],
      })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "paused");

    const needsHistory = sessions.some(
      (s) => (s.status === "paused" || s.status === "running") && s.blocks.length === 0,
    );
    expect(needsHistory).toBe(false);
  });

  it("completed sessions with empty blocks do not indicate history is needed", () => {
    const queue = [
      { id: 10, status: "completed" as const, item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 88, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({ sessionId: 88, status: "completed", blocks: [] })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "completed");

    const needsHistory = sessions.some(
      (s) => (s.status === "paused" || s.status === "running") && s.blocks.length === 0,
    );
    expect(needsHistory).toBe(false);
  });

  it("renders multiple session agents with unique keys using agentType from state", () => {
    const agents = new Map<string, AgentSessionState>([
      ["session:50", makeAgentState({ sessionId: 50, agentType: "session", status: "completed" })],
      ["session:51", makeAgentState({ sessionId: 51, agentType: "session", status: "paused" })],
      ["risk:52", makeAgentState({ sessionId: 52, agentType: "risk", status: "completed" })],
    ]);
    const { sessions } = buildSessionEntries([], agents, "building");

    expect(sessions).toHaveLength(3);
    expect(sessions.map(s => s.agentType)).toEqual(["session", "session", "risk"]);
    expect(sessions.map(s => s.sessionDbId)).toEqual([50, 51, 52]);
  });

  it("orders plan and prd sessions by sessionId (creation order), not hardcoded order", () => {
    const agents = new Map<string, AgentSessionState>([
      ["plan", makeAgentState({ sessionId: 20, status: "completed" })],
      ["prd", makeAgentState({ sessionId: 10, status: "completed" })],
    ]);
    const { sessions } = buildSessionEntries([], agents, "building");

    expect(sessions).toHaveLength(2);
    expect(sessions[0].agentType).toBe("prd");
    expect(sessions[1].agentType).toBe("plan");
  });

  it("orders plan before prd when plan has lower sessionId", () => {
    const agents = new Map<string, AgentSessionState>([
      ["plan", makeAgentState({ sessionId: 5, status: "completed" })],
      ["prd", makeAgentState({ sessionId: 15, status: "completed" })],
    ]);
    const { sessions } = buildSessionEntries([], agents, "building");

    expect(sessions).toHaveLength(2);
    expect(sessions[0].agentType).toBe("plan");
    expect(sessions[1].agentType).toBe("prd");
  });

  it("passes custom workflow phase slugs as agentType without mapping to execute", () => {
    const queue = [
      { id: 10, status: "running" as const, item_type: "specify", phase_id: 1, phase_title: "Specify", order_index: 0, group_index: 0, agent_session_id: 99, result: null },
      { id: 11, status: "blocked" as const, item_type: "analyze", phase_id: 2, phase_title: "Analyze", order_index: 1, group_index: 0, agent_session_id: null, result: null },
    ];
    const agents = new Map<string, AgentSessionState>([
      ["qi:10", makeAgentState({ sessionId: 99, status: "running", agentType: "specify" })],
    ]);
    const { sessions } = buildSessionEntries(queue, agents, "building");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentType).toBe("specify");
    expect(sessions[0].phaseTitle).toBe("Specify");
  });
});
