/**
 * Tests for useWorkflowWebSocket store — envelope construction and
 * agent_stream routing for plan/PRD/queue agents.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkflowStore, AGENT_TYPE_SYNTHETIC_KEYS } from "./useWorkflowWebSocket";
import type { FeatureSnapshot, AgentSessionSummary } from "./useWorkflowWebSocket";

// Mock ws-session-store so we can test routing without the full SDK parser.
vi.mock("@/stores/ws-session-store", () => {
  let counter = 0;
  return {
    createStreamingState: () => ({
      activeTextIndex: null,
      activeThinkingIndex: null,
      toolCalls: new Map(),
    }),
    processSdkMessage: (_msg: unknown, _state: unknown) => [
      { type: "append-text", text: `chunk-${++counter}` },
    ],
    applyMutations: (
      blocks: unknown[],
      mutations: Array<{ type: string; text: string }>,
      _state: unknown,
    ) => [
      ...blocks,
      ...mutations.map((m) => ({ type: "text" as const, content: m.text })),
    ],
  };
});

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type Listener = (e: unknown) => void;

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  private listeners: Record<string, Listener[]> = {};

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(_type: string, _fn: Listener) {}

  /** Test helper: fire an event */
  emit(type: string, event?: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(event ?? {});
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const origWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

  useWorkflowStore.setState({
    ws: null,
    featureId: null,
    projectId: null,
    queue: [],
    activeAgents: new Map(),
    planAgent: null,
    prdAgent: null,
    workflowStatus: "idle",
    pauseReason: null,
    autonomyLevel: 1,
    selectedItemId: null,
    error: null,
    hydrated: false,
  });
});

afterEach(() => {
  globalThis.WebSocket = origWebSocket;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectStore(featureId = 1, projectId = 1): MockWebSocket {
  useWorkflowStore.getState().connect(featureId, projectId);
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.emit("open");
  return ws;
}

function dispatch(ws: MockWebSocket, data: Record<string, unknown>) {
  ws.emit("message", { data: JSON.stringify(data) });
}

function makeAgentSession(overrides?: Record<string, unknown>) {
  return {
    sessionId: 0,
    blocks: [] as unknown[],
    status: "running" as const,
    streamingState: {
      activeTextIndex: null,
      activeThinkingIndex: null,
      toolCalls: new Map(),
    },
    pendingPermission: null,
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
    historyLoaded: false,
    claudeSessionId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkflowStore", () => {
  describe("envelope id field", () => {
    it("connect sends feature.start envelope with id field", () => {
      const ws = connectStore(42, 7);
      expect(ws.sent.length).toBeGreaterThanOrEqual(1);
      const envelope = JSON.parse(ws.sent[0]);
      expect(typeof envelope.id).toBe("string");
      expect(envelope.id.length).toBeGreaterThan(0);
      expect(envelope.domain).toBe("workflow");
      expect(envelope.action).toBe("feature.start");
    });

    it("send helper includes id field in envelopes", () => {
      const ws = connectStore(42, 7);
      ws.sent.length = 0;

      useWorkflowStore.getState().startPlan("test description");

      expect(ws.sent.length).toBe(1);
      const envelope = JSON.parse(ws.sent[0]);
      expect(typeof envelope.id).toBe("string");
      expect(envelope.id.length).toBeGreaterThan(0);
      expect(envelope.domain).toBe("workflow");
      expect(envelope.action).toBe("start_plan");
    });

    it("each envelope gets a unique id", () => {
      const ws = connectStore();
      ws.sent.length = 0;

      useWorkflowStore.getState().startPlan("a");
      useWorkflowStore.getState().startPlan("b");

      const id1 = JSON.parse(ws.sent[0]).id;
      const id2 = JSON.parse(ws.sent[1]).id;
      expect(id1).not.toBe(id2);
    });
  });

  describe("agent_stream routing", () => {
    it("routes queue_item_id -1 to planAgent", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: {
          queue_item_id: -1,
          session_id: 100,
          blocks: [{ type: "assistant", message: { role: "assistant", content: "hello" } }],
        },
      });

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent).not.toBeNull();
      expect(planAgent!.blocks.length).toBeGreaterThan(0);
    });

    it("routes queue_item_id -2 to prdAgent", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ prdAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: {
          queue_item_id: -2,
          session_id: 200,
          blocks: [{ type: "assistant" }],
        },
      });

      const { prdAgent } = useWorkflowStore.getState();
      expect(prdAgent).not.toBeNull();
      expect(prdAgent!.blocks.length).toBeGreaterThan(0);
    });

    it("routes positive queue_item_id to activeAgents", () => {
      const ws = connectStore();
      const agents = new Map();
      agents.set(42, makeAgentSession());
      useWorkflowStore.setState({ activeAgents: agents });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: 42, session_id: 300, blocks: [{ type: "assistant" }] },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(42);
      expect(agent).toBeDefined();
      expect(agent!.blocks.length).toBeGreaterThan(0);
    });

    it("creates planAgent on the fly when none exists", () => {
      useWorkflowStore.setState({ planAgent: null });
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: -1, session_id: 100, blocks: [{ type: "assistant" }] },
      });

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent).not.toBeNull();
      expect(planAgent!.blocks.length).toBeGreaterThan(0);
    });

    it("processes multiple blocks in a single message", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: {
          queue_item_id: -1,
          session_id: 100,
          blocks: [{ type: "a" }, { type: "b" }],
        },
      });

      expect(useWorkflowStore.getState().planAgent!.blocks.length).toBe(2);
    });

    it("ignores agent_stream with empty blocks and no message", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: -1, session_id: 100 },
      });

      expect(useWorkflowStore.getState().planAgent!.blocks.length).toBe(0);
    });

    it("ignores non-workflow domain messages", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "session",
        action: "agent_stream",
        payload: { queue_item_id: -1, blocks: [{ type: "text" }] },
      });

      expect(useWorkflowStore.getState().planAgent).toBeNull();
    });

    it("ignores agent_stream for unknown queue_item_id in activeAgents", () => {
      useWorkflowStore.setState({ activeAgents: new Map() });
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: 999, session_id: 1, blocks: [{ type: "assistant" }] },
      });

      expect(useWorkflowStore.getState().activeAgents.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Interrupt / Resume
  // -------------------------------------------------------------------------

  describe("interruptItem", () => {
    it("optimistically sets planAgent status to paused", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "running" }) });

      useWorkflowStore.getState().interruptItem(-1);

      expect(useWorkflowStore.getState().planAgent!.status).toBe("paused");
      // Should also send the interrupt envelope
      const sent = ws.sent.find(s => JSON.parse(s).action === "interrupt");
      expect(sent).toBeDefined();
      expect(JSON.parse(sent!).payload.agent_slot).toEqual({ type: "plan" });
    });

    it("optimistically sets prdAgent status to paused", () => {
      connectStore();
      useWorkflowStore.setState({ prdAgent: makeAgentSession({ status: "running" }) });

      useWorkflowStore.getState().interruptItem(-2);

      expect(useWorkflowStore.getState().prdAgent!.status).toBe("paused");
    });

    it("optimistically sets activeAgent and queue item to paused", () => {
      connectStore();
      const agents = new Map();
      agents.set(10, makeAgentSession({ sessionId: 100, status: "running" }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 10, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 100, result: null }],
      });

      useWorkflowStore.getState().interruptItem(10);

      expect(useWorkflowStore.getState().activeAgents.get(10)!.status).toBe("paused");
      expect(useWorkflowStore.getState().queue[0].status).toBe("paused");
    });
  });

  describe("interrupted message handler", () => {
    it("sets planAgent to paused on interrupted message", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "running" }) });

      dispatch(ws, {
        domain: "workflow",
        action: "interrupted",
        payload: { queue_item_id: -1, feature_id: 1, status: "interrupted" },
      });

      expect(useWorkflowStore.getState().planAgent!.status).toBe("paused");
    });

    it("sets activeAgent to paused and updates queue on interrupted message", () => {
      const ws = connectStore();
      const agents = new Map();
      agents.set(5, makeAgentSession({ sessionId: 50, status: "running" }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 5, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 50, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "interrupted",
        payload: { queue_item_id: 5, feature_id: 1, status: "interrupted" },
      });

      expect(useWorkflowStore.getState().activeAgents.get(5)!.status).toBe("paused");
      expect(useWorkflowStore.getState().queue[0].status).toBe("paused");
    });
  });

  describe("resumeItem", () => {
    it("sets planAgent back to running and sends prompt.send", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "paused" }) });

      useWorkflowStore.getState().resumeItem(-1);

      expect(useWorkflowStore.getState().planAgent!.status).toBe("running");
      const sent = ws.sent.find(s => JSON.parse(s).action === "prompt.send");
      expect(sent).toBeDefined();
      const envelope = JSON.parse(sent!);
      expect(envelope.payload.agent_slot).toEqual({ type: "plan" });
      expect(envelope.payload.text).toBe("");
    });

    it("sets activeAgent back to running and updates queue", () => {
      connectStore();
      const agents = new Map();
      agents.set(7, makeAgentSession({ sessionId: 70, status: "paused" }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 7, status: "paused", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 70, result: null }],
      });

      useWorkflowStore.getState().resumeItem(7);

      expect(useWorkflowStore.getState().activeAgents.get(7)!.status).toBe("running");
      expect(useWorkflowStore.getState().queue[0].status).toBe("running");
    });
  });

  describe("sendPromptToAgent", () => {
    it("sets paused planAgent back to running and appends user message", () => {
      connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "paused" }) });

      useWorkflowStore.getState().sendPromptToAgent(-1, "continue please");

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent!.status).toBe("running");
      expect(planAgent!.blocks.length).toBe(1);
      expect(planAgent!.blocks[0]).toMatchObject({ type: "user_message", content: "continue please" });
    });

    it("sets paused activeAgent back to running and updates queue", () => {
      connectStore();
      const agents = new Map();
      agents.set(3, makeAgentSession({ sessionId: 30, status: "paused" }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 3, status: "paused", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 30, result: null }],
      });

      useWorkflowStore.getState().sendPromptToAgent(3, "go on");

      expect(useWorkflowStore.getState().activeAgents.get(3)!.status).toBe("running");
      expect(useWorkflowStore.getState().queue[0].status).toBe("running");
    });
  });

  // -------------------------------------------------------------------------
  // hydrateFromSnapshot
  // -------------------------------------------------------------------------

  describe("hydrateFromSnapshot", () => {
    function makeSnapshot(overrides?: Partial<FeatureSnapshot>): FeatureSnapshot {
      return {
        workflow_status: "building",
        queue: [],
        agent_sessions: [],
        plan: null,
        worktree: null,
        autonomy_level: 3,
        ...overrides,
      };
    }

    function makeSessionSummary(overrides?: Partial<AgentSessionSummary>): AgentSessionSummary {
      return { id: 1, queue_item_id: null, status: "completed", agent_type: null, ...overrides };
    }

    it("routes plan agent_type to planAgent slot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 10, agent_type: "plan", status: "paused" })] }),
      );

      const { planAgent, activeAgents } = useWorkflowStore.getState();
      expect(planAgent).not.toBeNull();
      expect(planAgent!.sessionId).toBe(10);
      expect(planAgent!.status).toBe("paused");
      expect(activeAgents.size).toBe(0);
    });

    it("routes prd agent_type to prdAgent slot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 20, agent_type: "prd" })] }),
      );

      const { prdAgent, activeAgents } = useWorkflowStore.getState();
      expect(prdAgent).not.toBeNull();
      expect(prdAgent!.sessionId).toBe(20);
      expect(activeAgents.size).toBe(0);
    });

    it("routes session agent_type to activeAgents with SESSION_KEY", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 30, agent_type: "session" })] }),
      );

      const sessionKey = AGENT_TYPE_SYNTHETIC_KEYS.session;
      expect(useWorkflowStore.getState().activeAgents.has(sessionKey)).toBe(true);
      expect(useWorkflowStore.getState().activeAgents.get(sessionKey)!.sessionId).toBe(30);
    });

    it("routes review-fixer agent_type to activeAgents with REVIEW_FIXER_KEY", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 40, agent_type: "review-fixer" })] }),
      );

      const key = AGENT_TYPE_SYNTHETIC_KEYS["review-fixer"];
      expect(useWorkflowStore.getState().activeAgents.has(key)).toBe(true);
      expect(useWorkflowStore.getState().activeAgents.get(key)!.sessionId).toBe(40);
    });

    it("routes sessions with queue_item_id to activeAgents by that id", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          agent_sessions: [makeSessionSummary({ id: 50, queue_item_id: 99, agent_type: "execute" })],
          queue: [{ id: 99, item_type: "execute", phase_id: null, phase_title: null, status: "running", order_index: 0, group_index: null, agent_session_id: 50, result: null }],
        }),
      );

      expect(useWorkflowStore.getState().activeAgents.has(99)).toBe(true);
      expect(useWorkflowStore.getState().activeAgents.get(99)!.sessionId).toBe(50);
    });

    it("uses fallback key (-1000 - id) for unknown agent_type without queue_item_id", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 7, agent_type: "unknown_type" })] }),
      );

      expect(useWorkflowStore.getState().activeAgents.has(-1007)).toBe(true);
      expect(useWorkflowStore.getState().activeAgents.get(-1007)!.sessionId).toBe(7);
    });

    it("fallback key does not collide with synthetic keys", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          agent_sessions: [
            makeSessionSummary({ id: 60, agent_type: "session" }),
            makeSessionSummary({ id: 3, agent_type: "some_custom" }),
          ],
        }),
      );

      const { activeAgents } = useWorkflowStore.getState();
      expect(activeAgents.has(AGENT_TYPE_SYNTHETIC_KEYS.session)).toBe(true);
      expect(activeAgents.get(AGENT_TYPE_SYNTHETIC_KEYS.session)!.sessionId).toBe(60);
      expect(activeAgents.has(-1003)).toBe(true);
      expect(activeAgents.get(-1003)!.sessionId).toBe(3);
    });

    it("sets workflowStatus and hydrated flag", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ workflow_status: "plan_approval" }),
      );

      const state = useWorkflowStore.getState();
      expect(state.workflowStatus).toBe("plan_approval");
      expect(state.hydrated).toBe(true);
    });

    it("does not overwrite if already hydrated", () => {
      useWorkflowStore.setState({ hydrated: true, workflowStatus: "building" });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ workflow_status: "idle" }),
      );

      expect(useWorkflowStore.getState().workflowStatus).toBe("building");
    });

    it("sets historyLoaded false and blocks empty for all hydrated agents", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          agent_sessions: [
            makeSessionSummary({ id: 10, agent_type: "plan", status: "paused" }),
            makeSessionSummary({ id: 20, queue_item_id: 5, agent_type: "execute", status: "paused" }),
          ],
          queue: [{ id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "paused", order_index: 0, group_index: null, agent_session_id: 20, result: null }],
        }),
      );

      const state = useWorkflowStore.getState();
      expect(state.planAgent!.historyLoaded).toBe(false);
      expect(state.planAgent!.blocks).toEqual([]);
      expect(state.activeAgents.get(5)!.historyLoaded).toBe(false);
      expect(state.activeAgents.get(5)!.blocks).toEqual([]);
    });

    it("hydrates multiple agent types in a single snapshot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          workflow_status: "building",
          agent_sessions: [
            makeSessionSummary({ id: 1, agent_type: "plan", status: "completed" }),
            makeSessionSummary({ id: 2, agent_type: "prd", status: "completed" }),
            makeSessionSummary({ id: 3, agent_type: "session", status: "paused" }),
            makeSessionSummary({ id: 4, queue_item_id: 10, agent_type: "execute", status: "running" }),
          ],
        }),
      );

      const state = useWorkflowStore.getState();
      expect(state.planAgent).not.toBeNull();
      expect(state.prdAgent).not.toBeNull();
      expect(state.activeAgents.has(AGENT_TYPE_SYNTHETIC_KEYS.session)).toBe(true);
      expect(state.activeAgents.has(10)).toBe(true);
    });

    it("hydrates worktree state from snapshot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          worktree: { path: "/tmp/wt", branch: "feat-123", status: "ready" },
        }),
      );

      const state = useWorkflowStore.getState();
      expect(state.worktreeStatus).toBe("ready");
      expect(state.worktreePath).toBe("/tmp/wt");
      expect(state.worktreeBranch).toBe("feat-123");
    });

    it("leaves worktree as idle when snapshot has no worktree", () => {
      // Reset store to clear state from previous tests
      useWorkflowStore.setState({ hydrated: false, worktreeStatus: "idle", worktreePath: null, worktreeBranch: null });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ worktree: null }),
      );

      const state = useWorkflowStore.getState();
      expect(state.worktreeStatus).toBe("idle");
      expect(state.worktreePath).toBeNull();
      expect(state.worktreeBranch).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // populateAgentBlocks
  // -------------------------------------------------------------------------

  describe("populateAgentBlocks", () => {
    const fakeBlocks = [{ type: "text" as const, content: "hello" }];

    it("populates blocks for a plan agent in planAgent slot", () => {
      // Hydrate a plan agent with empty blocks
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [],
        agent_sessions: [{ id: 10, agent_type: "plan", status: "paused", queue_item_id: null }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      expect(useWorkflowStore.getState().planAgent!.blocks).toEqual([]);

      useWorkflowStore.getState().populateAgentBlocks(AGENT_TYPE_SYNTHETIC_KEYS.plan, fakeBlocks as never[]);

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent!.blocks).toEqual(fakeBlocks);
      expect(planAgent!.historyLoaded).toBe(true);
    });

    it("populates blocks for a prd agent in prdAgent slot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [],
        agent_sessions: [{ id: 20, agent_type: "prd", status: "paused", queue_item_id: null }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.getState().populateAgentBlocks(AGENT_TYPE_SYNTHETIC_KEYS.prd, fakeBlocks as never[]);

      const { prdAgent } = useWorkflowStore.getState();
      expect(prdAgent!.blocks).toEqual(fakeBlocks);
      expect(prdAgent!.historyLoaded).toBe(true);
    });

    it("populates blocks for a queue-based agent in activeAgents", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 99, item_type: "execute", phase_id: null, phase_title: null, status: "paused", order_index: 0, group_index: null, agent_session_id: 50, result: null }],
        agent_sessions: [{ id: 50, agent_type: "execute", status: "paused", queue_item_id: 99 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.getState().populateAgentBlocks(99, fakeBlocks as never[]);

      const agent = useWorkflowStore.getState().activeAgents.get(99);
      expect(agent!.blocks).toEqual(fakeBlocks);
      expect(agent!.historyLoaded).toBe(true);
    });

    it("does not overwrite if historyLoaded is already true", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [],
        agent_sessions: [{ id: 10, agent_type: "plan", status: "paused", queue_item_id: null }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      const planKey = AGENT_TYPE_SYNTHETIC_KEYS.plan;
      // First populate
      useWorkflowStore.getState().populateAgentBlocks(planKey, fakeBlocks as never[]);
      // Second populate with different blocks — should be a no-op
      useWorkflowStore.getState().populateAgentBlocks(planKey, [{ type: "text", content: "overwrite" }] as never[]);

      expect(useWorkflowStore.getState().planAgent!.blocks).toEqual(fakeBlocks);
    });

    it("does not overwrite if blocks are already non-empty", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "running", order_index: 0, group_index: null, agent_session_id: 30, result: null }],
        agent_sessions: [{ id: 30, agent_type: "execute", status: "running", queue_item_id: 5 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      // Simulate real-time blocks arriving via WS before populate
      useWorkflowStore.setState((state) => {
        const activeAgents = new Map(state.activeAgents);
        const agent = activeAgents.get(5)!;
        activeAgents.set(5, { ...agent, blocks: [{ type: "text", content: "live" }] as never[] });
        return { activeAgents };
      });

      useWorkflowStore.getState().populateAgentBlocks(5, fakeBlocks as never[]);

      // Should keep the live blocks, not the history fetch
      expect(useWorkflowStore.getState().activeAgents.get(5)!.blocks).toEqual([{ type: "text", content: "live" }]);
    });

    it("is a no-op when agent does not exist", () => {
      const before = useWorkflowStore.getState();
      useWorkflowStore.getState().populateAgentBlocks(999, fakeBlocks as never[]);
      const after = useWorkflowStore.getState();
      expect(after.activeAgents).toBe(before.activeAgents);
    });
  });

  // ── agent_paused (reconnect resume support) ──

  describe("agent_paused", () => {
    it("creates planAgent in paused state with claudeSessionId on reconnect", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().planAgent).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.plan,
          session_id: 42,
          agent_type: "plan",
          claude_session_id: "cc-sess-abc",
        },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan).not.toBeNull();
      expect(plan!.status).toBe("paused");
      expect(plan!.sessionId).toBe(42);
      expect(plan!.claudeSessionId).toBe("cc-sess-abc");
    });

    it("preserves existing planAgent blocks when paused", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ sessionId: 42, blocks: [{ type: "text", content: "hello" }] }) as never,
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.plan,
          session_id: 42,
          agent_type: "plan",
          claude_session_id: "cc-sess-xyz",
        },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan!.status).toBe("paused");
      expect(plan!.claudeSessionId).toBe("cc-sess-xyz");
      expect(plan!.blocks).toHaveLength(1);
    });

    it("creates prdAgent in paused state on reconnect", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.prd,
          session_id: 99,
          agent_type: "prd",
          claude_session_id: "cc-prd-sess",
        },
      });

      const prd = useWorkflowStore.getState().prdAgent;
      expect(prd).not.toBeNull();
      expect(prd!.status).toBe("paused");
      expect(prd!.claudeSessionId).toBe("cc-prd-sess");
    });

    it("creates activeAgent in paused state for session key", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.session,
          session_id: 55,
          agent_type: "session",
          claude_session_id: "cc-session-id",
        },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(AGENT_TYPE_SYNTHETIC_KEYS.session);
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("paused");
      expect(agent!.claudeSessionId).toBe("cc-session-id");
    });
  });

  // ── agent_session_id (session ID capture during streaming) ──

  describe("agent_session_id", () => {
    it("sets claudeSessionId on existing planAgent", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ sessionId: 10 }) as never,
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.plan,
          session_id: 10,
          claude_session_id: "captured-uuid",
        },
      });

      expect(useWorkflowStore.getState().planAgent!.claudeSessionId).toBe("captured-uuid");
    });

    it("is a no-op when planAgent does not exist", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().planAgent).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.plan,
          session_id: 10,
          claude_session_id: "captured-uuid",
        },
      });

      // Should remain null — no agent to patch
      expect(useWorkflowStore.getState().planAgent).toBeNull();
    });

    it("sets claudeSessionId on existing activeAgent", () => {
      const ws = connectStore();
      const agents = new Map();
      agents.set(7, makeAgentSession({ sessionId: 7 }));
      useWorkflowStore.setState({ activeAgents: agents });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: 7,
          session_id: 7,
          claude_session_id: "active-uuid",
        },
      });

      expect(useWorkflowStore.getState().activeAgents.get(7)!.claudeSessionId).toBe("active-uuid");
    });

    it("ignores empty claude_session_id", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ sessionId: 10 }) as never,
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: AGENT_TYPE_SYNTHETIC_KEYS.plan,
          session_id: 10,
          claude_session_id: "",
        },
      });

      expect(useWorkflowStore.getState().planAgent!.claudeSessionId).toBeNull();
    });
  });

  // ── hydrateFromSnapshot includes claudeSessionId ──

  describe("hydrateFromSnapshot with claudeSessionId", () => {
    it("hydrates plan agent with claude_session_id from snapshot", () => {
      const snapshot: FeatureSnapshot = {
        workflow_status: "planning",
        queue: [],
        agent_sessions: [
          { id: 100, agent_type: "plan", status: "paused", queue_item_id: null, claude_session_id: "snap-uuid" } as AgentSessionSummary,
        ],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      };

      useWorkflowStore.getState().hydrateFromSnapshot(snapshot);

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan).not.toBeNull();
      expect(plan!.claudeSessionId).toBe("snap-uuid");
      expect(plan!.status).toBe("paused");
    });

    it("hydrates agent with null claude_session_id when not present", () => {
      const snapshot: FeatureSnapshot = {
        workflow_status: "planning",
        queue: [],
        agent_sessions: [
          { id: 101, agent_type: "plan", status: "completed", queue_item_id: null, claude_session_id: null } as AgentSessionSummary,
        ],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      };

      useWorkflowStore.getState().hydrateFromSnapshot(snapshot);

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan).not.toBeNull();
      expect(plan!.claudeSessionId).toBeNull();
    });
  });

  describe("feature.renamed (cross-domain)", () => {
    it("sets featureTitle from session-domain event", () => {
      const ws = connectStore(1);
      dispatch(ws, {
        id: "srv-1",
        domain: "session",
        action: "feature.renamed",
        payload: { feature_id: 1, title: "Auto Named Feature" },
      });
      expect(useWorkflowStore.getState().featureTitle).toBe("Auto Named Feature");
    });

    it("ignores feature.renamed with no title", () => {
      const ws = connectStore(1);
      dispatch(ws, {
        id: "srv-1",
        domain: "session",
        action: "feature.renamed",
        payload: { feature_id: 1 },
      });
      expect(useWorkflowStore.getState().featureTitle).toBeNull();
    });

    it("resets featureTitle on new connect", () => {
      const ws = connectStore(1);
      dispatch(ws, {
        id: "srv-1",
        domain: "session",
        action: "feature.renamed",
        payload: { feature_id: 1, title: "Old Name" },
      });
      expect(useWorkflowStore.getState().featureTitle).toBe("Old Name");

      // Reconnect to a different feature
      connectStore(2);
      expect(useWorkflowStore.getState().featureTitle).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // agent_user_message
  // -------------------------------------------------------------------------

  describe("agent_user_message", () => {
    it("adds user_message block to planAgent", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -1, session_id: 10, content: "Create a plan for auth" },
      });

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent).not.toBeNull();
      expect(planAgent!.blocks).toHaveLength(1);
      expect(planAgent!.blocks[0]).toMatchObject({
        type: "user_message",
        content: "Create a plan for auth",
      });
    });

    it("adds user_message block to prdAgent", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ prdAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -2, session_id: 20, content: "PRD for feature X" },
      });

      const { prdAgent } = useWorkflowStore.getState();
      expect(prdAgent).not.toBeNull();
      expect(prdAgent!.blocks).toHaveLength(1);
      expect(prdAgent!.blocks[0]).toMatchObject({
        type: "user_message",
        content: "PRD for feature X",
      });
    });

    it("adds user_message block to activeAgents queue item", () => {
      const ws = connectStore();
      const agents = new Map();
      agents.set(42, makeAgentSession());
      useWorkflowStore.setState({ activeAgents: agents });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: 42, session_id: 30, content: "Implement the phase" },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(42);
      expect(agent).toBeDefined();
      expect(agent!.blocks).toHaveLength(1);
      expect(agent!.blocks[0]).toMatchObject({
        type: "user_message",
        content: "Implement the phase",
      });
    });

    it("creates planAgent on the fly if not yet initialized", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: null });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -1, session_id: 10, content: "Plan this" },
      });

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent).not.toBeNull();
      expect(planAgent!.blocks).toHaveLength(1);
      expect(planAgent!.blocks[0]).toMatchObject({ type: "user_message", content: "Plan this" });
    });

    it("creates activeAgent on the fly for queue items", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ activeAgents: new Map() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: 99, session_id: 50, content: "Execute phase" },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(99);
      expect(agent).toBeDefined();
      expect(agent!.blocks).toHaveLength(1);
      expect(agent!.blocks[0]).toMatchObject({ type: "user_message", content: "Execute phase" });
    });

    it("ignores agent_user_message with empty content", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -1, session_id: 10, content: "" },
      });

      expect(useWorkflowStore.getState().planAgent!.blocks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Plan approval flow — approvePlan / rejectPlan
  // -------------------------------------------------------------------------

  describe("plan approval flow", () => {
    it("plan_ready sets planAgent to paused (not completed)", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "running" }) });

      dispatch(ws, {
        domain: "workflow",
        action: "plan_ready",
        payload: { feature_id: 1 },
      });

      const state = useWorkflowStore.getState();
      expect(state.planAgent!.status).toBe("paused");
      expect(state.workflowStatus).toBe("plan_approval");
    });

    it("prd_ready sets prdAgent to paused (not completed)", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ prdAgent: makeAgentSession({ status: "running" }) });

      dispatch(ws, {
        domain: "workflow",
        action: "prd_ready",
        payload: { feature_id: 1 },
      });

      expect(useWorkflowStore.getState().prdAgent!.status).toBe("paused");
    });

    it("approvePlan sends message without optimistic state update", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "plan_approval",
      });

      useWorkflowStore.getState().approvePlan("req-1");

      const state = useWorkflowStore.getState();
      // No optimistic update — status stays until backend confirms via status_changed
      expect(state.planAgent!.status).toBe("paused");
      expect(state.workflowStatus).toBe("plan_approval");
      const sent = ws.sent.find(s => JSON.parse(s).action === "plan.approved");
      expect(sent).toBeDefined();
      expect(JSON.parse(sent!).payload.request_id).toBe("req-1");
    });

    it("rejectPlan sends message without optimistic state update", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "plan_approval",
      });

      useWorkflowStore.getState().rejectPlan("needs more detail", "req-2");

      const state = useWorkflowStore.getState();
      // No optimistic update — status stays until backend confirms via status_changed
      expect(state.planAgent!.status).toBe("paused");
      expect(state.workflowStatus).toBe("plan_approval");
      const sent = ws.sent.find(s => JSON.parse(s).action === "plan.rejected");
      expect(sent).toBeDefined();
      const envelope = JSON.parse(sent!);
      expect(envelope.payload.feedback).toBe("needs more detail");
      expect(envelope.payload.request_id).toBe("req-2");
    });

    it("approvePlan is safe when planAgent is null", () => {
      connectStore();
      useWorkflowStore.setState({ planAgent: null });

      useWorkflowStore.getState().approvePlan();

      expect(useWorkflowStore.getState().planAgent).toBeNull();
      // No optimistic update — workflowStatus stays idle
      expect(useWorkflowStore.getState().workflowStatus).toBe("idle");
    });

    it("approvePlan sends prd.approved when workflowStatus is prd", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "prd",
      });

      useWorkflowStore.getState().approvePlan("req-prd-1");

      const sent = ws.sent.find(s => JSON.parse(s).action === "prd.approved");
      expect(sent).toBeDefined();
      expect(JSON.parse(sent!).payload.request_id).toBe("req-prd-1");
      // Should NOT have sent plan.approved
      const planSent = ws.sent.find(s => JSON.parse(s).action === "plan.approved");
      expect(planSent).toBeUndefined();
    });

    it("approvePlan adds user_message to prdAgent when workflowStatus is prd", () => {
      connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "prd",
      });

      useWorkflowStore.getState().approvePlan();

      const { prdAgent } = useWorkflowStore.getState();
      expect(prdAgent!.blocks).toHaveLength(1);
      expect(prdAgent!.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("PRD") });
    });

    it("approvePlan adds user_message to planAgent when workflowStatus is plan_approval", () => {
      connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "plan_approval",
      });

      useWorkflowStore.getState().approvePlan();

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent!.blocks).toHaveLength(1);
      expect(planAgent!.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("Plan") });
    });

    it("rejectPlan sends prd.rejected when workflowStatus is prd", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "prd",
      });

      useWorkflowStore.getState().rejectPlan("needs work", "req-prd-2");

      const sent = ws.sent.find(s => JSON.parse(s).action === "prd.rejected");
      expect(sent).toBeDefined();
      const envelope = JSON.parse(sent!);
      expect(envelope.payload.feedback).toBe("needs work");
      expect(envelope.payload.request_id).toBe("req-prd-2");
      // Should NOT have sent plan.rejected
      const planSent = ws.sent.find(s => JSON.parse(s).action === "plan.rejected");
      expect(planSent).toBeUndefined();
    });

    it("rejectPlan adds user_message to prdAgent when workflowStatus is prd", () => {
      connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "prd",
      });

      useWorkflowStore.getState().rejectPlan("more detail please");

      const { prdAgent } = useWorkflowStore.getState();
      expect(prdAgent!.blocks).toHaveLength(1);
      expect(prdAgent!.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("PRD") });
      expect(prdAgent!.blocks[0]).toMatchObject({ content: expect.stringContaining("more detail please") });
    });

    it("rejectPlan adds user_message to planAgent when workflowStatus is plan_approval", () => {
      connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "plan_approval",
      });

      useWorkflowStore.getState().rejectPlan("needs more detail");

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent!.blocks).toHaveLength(1);
      expect(planAgent!.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("Plan") });
      expect(planAgent!.blocks[0]).toMatchObject({ content: expect.stringContaining("needs more detail") });
    });
  });

  // -------------------------------------------------------------------------
  // status_changed — agent status resets
  // -------------------------------------------------------------------------

  describe("status_changed agent resets", () => {
    it("resets planAgent status to running when leaving plan_approval", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "plan_approval",
      });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "plan_approval", status: "planning" },
      });

      expect(useWorkflowStore.getState().planAgent!.status).toBe("running");
      expect(useWorkflowStore.getState().workflowStatus).toBe("planning");
    });

    it("does not reset planAgent when staying in plan_approval", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "plan_approval",
      });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "plan_approval", status: "plan_approval" },
      });

      expect(useWorkflowStore.getState().planAgent!.status).toBe("paused");
    });

    it("sets prdAgent to completed when transitioning from prd to planning", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "prd",
      });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "prd", status: "planning" },
      });

      expect(useWorkflowStore.getState().prdAgent!.status).toBe("completed");
      expect(useWorkflowStore.getState().workflowStatus).toBe("planning");
    });

    it("does not reset prdAgent when prd transitions to non-planning status", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "paused" }),
        workflowStatus: "prd",
      });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "prd", status: "error" },
      });

      // prdAgent stays paused — only prd→planning triggers completed
      expect(useWorkflowStore.getState().prdAgent!.status).toBe("paused");
    });

    it("does not reset prdAgent if it is not paused", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        prdAgent: makeAgentSession({ status: "running" }),
        workflowStatus: "prd",
      });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "prd", status: "planning" },
      });

      // Only paused prdAgents get set to completed
      expect(useWorkflowStore.getState().prdAgent!.status).toBe("running");
    });
  });

  // -------------------------------------------------------------------------
  // item_completed / item_error — agent status updates via patchAgentByItemId
  // -------------------------------------------------------------------------

  describe("item_completed and item_error", () => {
    it("item_completed sets planAgent (synthetic id -1) to completed", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "running" }) });

      dispatch(ws, {
        domain: "workflow",
        action: "item_completed",
        payload: { queue_item_id: -1, feature_id: 1 },
      });

      expect(useWorkflowStore.getState().planAgent!.status).toBe("completed");
    });

    it("item_completed sets prdAgent (synthetic id -2) to completed", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ prdAgent: makeAgentSession({ status: "running" }) });

      dispatch(ws, {
        domain: "workflow",
        action: "item_completed",
        payload: { queue_item_id: -2, feature_id: 1 },
      });

      expect(useWorkflowStore.getState().prdAgent!.status).toBe("completed");
    });

    it("item_completed sets activeAgent to completed and updates queue", () => {
      const ws = connectStore();
      const agents = new Map();
      agents.set(10, makeAgentSession({ status: "running" }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 10, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 100, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "item_completed",
        payload: { queue_item_id: 10, feature_id: 1 },
      });

      expect(useWorkflowStore.getState().activeAgents.get(10)!.status).toBe("completed");
      expect(useWorkflowStore.getState().queue[0].status).toBe("completed");
    });

    it("item_error sets planAgent (synthetic id -1) to error", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession({ status: "running" }) });

      dispatch(ws, {
        domain: "workflow",
        action: "item_error",
        payload: { queue_item_id: -1, error: "something broke", feature_id: 1 },
      });

      expect(useWorkflowStore.getState().planAgent!.status).toBe("error");
    });

    it("item_error sets activeAgent to error and updates queue", () => {
      const ws = connectStore();
      const agents = new Map();
      agents.set(5, makeAgentSession({ status: "running" }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 5, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 50, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "item_error",
        payload: { queue_item_id: 5, error: "timeout", feature_id: 1 },
      });

      expect(useWorkflowStore.getState().activeAgents.get(5)!.status).toBe("error");
      expect(useWorkflowStore.getState().queue[0].status).toBe("error");
      expect(useWorkflowStore.getState().error).toBe("timeout");
    });
  });

  // -------------------------------------------------------------------------
  // plan_content — live plan display
  // -------------------------------------------------------------------------

  describe("plan_content", () => {
    it("injects tool_call block with __show_plan toolName", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "plan_content",
        payload: { content: "# My Plan\n- Phase 1\n- Phase 2" },
      });

      const { planAgent } = useWorkflowStore.getState();
      expect(planAgent!.blocks).toHaveLength(1);
      expect(planAgent!.blocks[0]).toMatchObject({
        type: "tool_call",
        toolName: "__show_plan",
      });
      const args = JSON.parse((planAgent!.blocks[0] as { toolArgs: string }).toolArgs);
      expect(args.plan).toBe("# My Plan\n- Phase 1\n- Phase 2");
    });

    it("creates planAgent on the fly if null", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: null });

      dispatch(ws, {
        domain: "workflow",
        action: "plan_content",
        payload: { content: "Plan text" },
      });

      expect(useWorkflowStore.getState().planAgent).not.toBeNull();
      expect(useWorkflowStore.getState().planAgent!.blocks).toHaveLength(1);
    });

    it("ignores plan_content with empty content", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ planAgent: makeAgentSession() });

      dispatch(ws, {
        domain: "workflow",
        action: "plan_content",
        payload: { content: "" },
      });

      expect(useWorkflowStore.getState().planAgent!.blocks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // feature.updated — cache invalidation
  // -------------------------------------------------------------------------

  describe("feature.updated", () => {
    it("calls invalidateFeatureQueries for feature.updated events", () => {
      const ws = connectStore(42);

      // We can't easily mock invalidateFeatureQueries since it's imported,
      // but we can verify the message is processed (doesn't throw, doesn't
      // update workflow state).
      dispatch(ws, {
        domain: "feature",
        action: "updated",
        payload: { feature_id: 42, changed: ["phases", "progress"] },
      });

      // Verify no workflow state was modified (it's a cross-domain event)
      expect(useWorkflowStore.getState().workflowStatus).toBe("idle");
    });
  });

  // -------------------------------------------------------------------------
  // Block preservation across started events
  // -------------------------------------------------------------------------

  describe("block preservation on started events", () => {
    it("session.started preserves existing blocks", () => {
      const ws = connectStore();
      // Simulate user message arriving before session.started
      const agents = new Map();
      agents.set(-3, makeAgentSession({
        blocks: [{ type: "user_message", content: "Hello" }],
      }));
      useWorkflowStore.setState({ activeAgents: agents });

      dispatch(ws, {
        domain: "workflow",
        action: "session.started",
        payload: { feature_id: 1, session_id: 77 },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(-3);
      expect(agent).toBeDefined();
      expect(agent!.sessionId).toBe(77);
      expect(agent!.blocks).toHaveLength(1);
      expect(agent!.blocks[0]).toMatchObject({ type: "user_message", content: "Hello" });
    });

    it("queue_update before item_started populates queue so agent is matched", () => {
      const ws = connectStore();

      // 1. queue_update arrives first (the fix: sent before advance)
      dispatch(ws, {
        domain: "workflow",
        action: "queue_update",
        payload: {
          feature_id: 1,
          items: [
            { id: 10, status: "ready", item_type: "execute", phase_id: 1, phase_title: "Setup", order_index: 0, group_index: 0, agent_session_id: null, result: null },
          ],
        },
      });

      // Queue should be populated
      expect(useWorkflowStore.getState().queue).toHaveLength(1);
      expect(useWorkflowStore.getState().queue[0].id).toBe(10);

      // 2. item_started arrives after
      dispatch(ws, {
        domain: "workflow",
        action: "item_started",
        payload: { feature_id: 1, queue_item_id: 10, session_id: 55, item_type: "execute" },
      });

      // Agent should be created for the queue item
      const agent = useWorkflowStore.getState().activeAgents.get(10);
      expect(agent).toBeDefined();
      expect(agent!.sessionId).toBe(55);

      // Queue item status should be updated to running
      const queueItem = useWorkflowStore.getState().queue.find((q) => q.id === 10);
      expect(queueItem?.status).toBe("running");
    });

    it("item_started preserves existing blocks", () => {
      const ws = connectStore();
      // Simulate user message arriving before item_started
      const agents = new Map();
      agents.set(10, makeAgentSession({
        blocks: [{ type: "user_message", content: "Execute this" }],
      }));
      useWorkflowStore.setState({
        activeAgents: agents,
        queue: [{ id: 10, status: "ready", item_type: "execute", phase_id: 1, phase_title: "P1", order_index: 0, group_index: 0, agent_session_id: null, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "item_started",
        payload: { feature_id: 1, queue_item_id: 10, session_id: 88, item_type: "execute" },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(10);
      expect(agent).toBeDefined();
      expect(agent!.sessionId).toBe(88);
      expect(agent!.blocks).toHaveLength(1);
      expect(agent!.blocks[0]).toMatchObject({ type: "user_message", content: "Execute this" });
    });
  });

  describe("startingBuild / continuingBuild flags", () => {
    it("startBuild sets startingBuild flag", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().startingBuild).toBe(false);
      useWorkflowStore.getState().startBuild();
      expect(useWorkflowStore.getState().startingBuild).toBe(true);
      // Verify the message was sent
      expect(ws.sent.length).toBeGreaterThan(0);
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.action).toBe("start_build");
    });

    it("continueWorkflow sets continuingBuild flag", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().continuingBuild).toBe(false);
      useWorkflowStore.getState().continueWorkflow();
      expect(useWorkflowStore.getState().continuingBuild).toBe(true);
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.action).toBe("continue");
    });

    it("status_changed to building clears both flags", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ startingBuild: true, continuingBuild: true });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { status: "building", previous_status: "ready_to_build" },
      });

      expect(useWorkflowStore.getState().startingBuild).toBe(false);
      expect(useWorkflowStore.getState().continuingBuild).toBe(false);
    });

    it("status_changed to paused clears both flags", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ startingBuild: true, continuingBuild: true });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { status: "paused", previous_status: "building" },
      });

      expect(useWorkflowStore.getState().startingBuild).toBe(false);
      expect(useWorkflowStore.getState().continuingBuild).toBe(false);
    });

    it("status_changed to error clears both flags", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ continuingBuild: true });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { status: "error", previous_status: "building" },
      });

      expect(useWorkflowStore.getState().continuingBuild).toBe(false);
    });

    it("workflow error event clears both flags", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ startingBuild: true, continuingBuild: true });

      dispatch(ws, {
        domain: "workflow",
        action: "error",
        payload: { message: "Something failed" },
      });

      expect(useWorkflowStore.getState().startingBuild).toBe(false);
      expect(useWorkflowStore.getState().continuingBuild).toBe(false);
    });

    it("connect resets flags", () => {
      connectStore();
      useWorkflowStore.setState({ startingBuild: true, continuingBuild: true });
      // Reconnect
      connectStore(2, 2);
      expect(useWorkflowStore.getState().startingBuild).toBe(false);
      expect(useWorkflowStore.getState().continuingBuild).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // agent_running / agent_paused with AgentSlot format (reconnection)
  // -------------------------------------------------------------------------

  describe("agent_running with agent_slot", () => {
    it("routes to planAgent when slot is plan", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().planAgent).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 100, agent_type: "plan" },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan).not.toBeNull();
      expect(plan!.status).toBe("running");
      expect(plan!.sessionId).toBe(100);
    });

    it("routes to prdAgent when slot is prd", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().prdAgent).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "prd" }, session_id: 200, agent_type: "prd" },
      });

      const prd = useWorkflowStore.getState().prdAgent;
      expect(prd).not.toBeNull();
      expect(prd!.status).toBe("running");
      expect(prd!.sessionId).toBe(200);
    });

    it("routes to activeAgents for queue items", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        queue: [{ id: 42, status: "ready", item_type: "execute", phase_id: 1, phase_title: "P1", order_index: 0, group_index: 0, agent_session_id: null, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 42 }, session_id: 300, agent_type: "execute" },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(42);
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("running");
      expect(agent!.sessionId).toBe(300);
    });

    it("updates queue item status to running", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        queue: [{ id: 42, status: "ready", item_type: "execute", phase_id: 1, phase_title: "P1", order_index: 0, group_index: 0, agent_session_id: null, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 42 }, session_id: 300, agent_type: "execute" },
      });

      const queueItem = useWorkflowStore.getState().queue.find(q => q.id === 42);
      expect(queueItem!.status).toBe("running");
      expect(queueItem!.agent_session_id).toBe(300);
    });

    it("sets selectedItemId if none is set", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().selectedItemId).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 42 }, session_id: 300, agent_type: "execute" },
      });

      expect(useWorkflowStore.getState().selectedItemId).toBe(42);
    });

    it("does not overwrite existing selectedItemId", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ selectedItemId: 10 });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 42 }, session_id: 300, agent_type: "execute" },
      });

      expect(useWorkflowStore.getState().selectedItemId).toBe(10);
    });

    it("creates agent session if none exists", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().planAgent).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 100, agent_type: "plan" },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan).not.toBeNull();
      expect(plan!.blocks).toEqual([]);
      expect(plan!.status).toBe("running");
    });

    it("preserves existing agent blocks when patching", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ sessionId: 100, blocks: [{ type: "text", content: "existing" }] }) as never,
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 100, agent_type: "plan" },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan!.status).toBe("running");
      expect(plan!.blocks).toHaveLength(1);
      expect(plan!.blocks[0]).toMatchObject({ type: "text", content: "existing" });
    });
  });

  describe("agent_paused with agent_slot", () => {
    it("routes to planAgent with paused status and claudeSessionId", () => {
      const ws = connectStore();
      expect(useWorkflowStore.getState().planAgent).toBeNull();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 42, agent_type: "plan", claude_session_id: "cc-123" },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan).not.toBeNull();
      expect(plan!.status).toBe("paused");
      expect(plan!.sessionId).toBe(42);
      expect(plan!.claudeSessionId).toBe("cc-123");
    });

    it("routes to prdAgent with paused status and claudeSessionId", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "prd" }, session_id: 99, agent_type: "prd", claude_session_id: "cc-prd" },
      });

      const prd = useWorkflowStore.getState().prdAgent;
      expect(prd).not.toBeNull();
      expect(prd!.status).toBe("paused");
      expect(prd!.claudeSessionId).toBe("cc-prd");
    });

    it("routes to activeAgents for queue items with paused status", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 55 }, session_id: 400, agent_type: "execute", claude_session_id: "cc-qi" },
      });

      const agent = useWorkflowStore.getState().activeAgents.get(55);
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("paused");
      expect(agent!.sessionId).toBe(400);
      expect(agent!.claudeSessionId).toBe("cc-qi");
    });

    it("preserves existing agent blocks when paused", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        planAgent: makeAgentSession({ sessionId: 42, blocks: [{ type: "text", content: "work" }] }) as never,
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 42, agent_type: "plan", claude_session_id: "cc-456" },
      });

      const plan = useWorkflowStore.getState().planAgent;
      expect(plan!.status).toBe("paused");
      expect(plan!.claudeSessionId).toBe("cc-456");
      expect(plan!.blocks).toHaveLength(1);
      expect(plan!.blocks[0]).toMatchObject({ type: "text", content: "work" });
    });
  });
});
