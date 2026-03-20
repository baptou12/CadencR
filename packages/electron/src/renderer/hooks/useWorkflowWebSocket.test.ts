/**
 * Tests for useWorkflowWebSocket store — envelope construction and
 * agent_stream routing for plan/PRD/queue agents.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkflowStore } from "./useWorkflowWebSocket";

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
      expect(JSON.parse(sent!).payload.queue_item_id).toBe(-1);
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
      expect(envelope.payload.queue_item_id).toBe(-1);
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
});
