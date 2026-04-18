/**
 * Tests for useWorkflowWebSocket store — envelope construction and
 * agent_stream routing for plan/PRD/queue agents.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkflowStore } from "./useWorkflowWebSocket";
import { PLAN_KEY, PRD_KEY } from "@/types/workflow";
import type { FeatureSnapshot, AgentSessionSummary, AgentSessionState } from "@/types/workflow";
import type { AgentBlockData } from "@/components/AgentBlock";

vi.mock("@/lib/ws-url", () => ({
  getWsUrl: () => "ws://localhost:5005/ws",
  getTerminalWsUrl: () => "ws://localhost:5005/api/terminal/ws",
  getWsProtocols: () => [],
}));

// Mock ws-session-store so we can test routing without the full SDK parser.
vi.mock("@/stores/ws-session-store", () => {
  let counter = 0;
  return {
    createStreamingState: () => ({
      activeTextIndex: null,
      activeThinkingIndex: null,
      toolCalls: new Map(),
    }),
    processSdkMessage: (_msg: unknown, _state: unknown) => ({
      mutations: [
        { type: "append-text", text: `chunk-${++counter}` },
      ],
      signals: {
        enterPlanModeRequested: false,
      },
    }),
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
    conn: null,
    featureId: null,
    projectId: null,
    queue: [],
    agents: new Map(),
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

function makeAgentSession(overrides?: Record<string, unknown>): AgentSessionState {
  return {
    sessionId: 0,
    agentType: "execute",
    blocks: [] as AgentBlockData[],
    status: "running" as const,
    streamingState: {
      activeTextIndex: null,
      activeThinkingIndex: null,
      toolCalls: new Map(),
    } as unknown as AgentSessionState["streamingState"],
    pendingPermission: null,
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
    historyLoaded: false,
    runtimeSessionId: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 0,
    hasFileChanges: false,
    ...overrides,
  } as AgentSessionState;
}

/** Helper to set a single agent in the store */
function setAgent(key: string, agent: AgentSessionState) {
  const agents = new Map(useWorkflowStore.getState().agents);
  agents.set(key, agent);
  useWorkflowStore.setState({ agents });
}

/** Helper to get an agent from the store */
function getAgent(key: string): AgentSessionState | undefined {
  return useWorkflowStore.getState().agents.get(key);
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
    it("routes queue_item_id -1 to plan agent", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: {
          queue_item_id: -1,
          session_id: 100,
          blocks: [{ type: "assistant", message: { role: "assistant", content: "hello" } }],
        },
      });

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.blocks.length).toBeGreaterThan(0);
    });

    it("routes queue_item_id -2 to prd agent", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: {
          queue_item_id: -2,
          session_id: 200,
          blocks: [{ type: "assistant" }],
        },
      });

      const prd = getAgent(PRD_KEY);
      expect(prd).toBeDefined();
      expect(prd!.blocks.length).toBeGreaterThan(0);
    });

    it("routes positive queue_item_id to agents map", () => {
      const ws = connectStore();
      setAgent("qi:42", makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: 42, session_id: 300, blocks: [{ type: "assistant" }] },
      });

      const agent = getAgent("qi:42");
      expect(agent).toBeDefined();
      expect(agent!.blocks.length).toBeGreaterThan(0);
    });

    it("creates plan agent on the fly when none exists", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: -1, session_id: 100, blocks: [{ type: "assistant" }] },
      });

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.blocks.length).toBeGreaterThan(0);
    });

    it("processes multiple blocks in a single message", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: {
          queue_item_id: -1,
          session_id: 100,
          blocks: [{ type: "a" }, { type: "b" }],
        },
      });

      expect(getAgent(PLAN_KEY)!.blocks.length).toBe(2);
    });

    it("ignores agent_stream with empty blocks and no message", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: -1, session_id: 100 },
      });

      expect(getAgent(PLAN_KEY)!.blocks.length).toBe(0);
    });

    it("ignores non-workflow domain messages", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "session",
        action: "agent_stream",
        payload: { queue_item_id: -1, blocks: [{ type: "text" }] },
      });

      expect(getAgent(PLAN_KEY)).toBeUndefined();
    });

    it("ignores agent_stream for unknown queue_item_id in agents", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_stream",
        payload: { queue_item_id: 999, session_id: 1, blocks: [{ type: "assistant" }] },
      });

      expect(useWorkflowStore.getState().agents.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Interrupt / Resume
  // -------------------------------------------------------------------------

  describe("interruptItem", () => {
    it("sets plan agent status to paused", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "running" }));

      useWorkflowStore.getState().interruptItem(PLAN_KEY);

      expect(getAgent(PLAN_KEY)!.status).toBe("paused");
      const sent = ws.sent.find(s => JSON.parse(s).action === "interrupt");
      expect(sent).toBeDefined();
      expect(JSON.parse(sent!).payload.agent_slot).toEqual({ type: "plan" });
    });

    it("sets prd agent status to paused", () => {
      connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "running" }));

      useWorkflowStore.getState().interruptItem(PRD_KEY);

      expect(getAgent(PRD_KEY)!.status).toBe("paused");
    });

    it("sets active agent and queue item to paused", () => {
      connectStore();
      setAgent("qi:10", makeAgentSession({ sessionId: 100, status: "running" }));
      useWorkflowStore.setState({
        queue: [{ id: 10, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 100, result: null }],
      });

      useWorkflowStore.getState().interruptItem("qi:10");

      expect(getAgent("qi:10")!.status).toBe("paused");
      expect(useWorkflowStore.getState().queue[0].status).toBe("paused");
    });
  });

  describe("interrupted message handler", () => {
    it("sets plan agent to paused on interrupted message", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "running" }));

      dispatch(ws, {
        domain: "workflow",
        action: "interrupted",
        payload: { queue_item_id: -1, feature_id: 1, status: "interrupted" },
      });

      expect(getAgent(PLAN_KEY)!.status).toBe("paused");
    });

    it("sets active agent to paused and updates queue on interrupted message", () => {
      const ws = connectStore();
      setAgent("qi:5", makeAgentSession({ sessionId: 50, status: "running" }));
      useWorkflowStore.setState({
        queue: [{ id: 5, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 50, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "interrupted",
        payload: { queue_item_id: 5, feature_id: 1, status: "interrupted" },
      });

      expect(getAgent("qi:5")!.status).toBe("paused");
      expect(useWorkflowStore.getState().queue[0].status).toBe("paused");
    });
  });

  describe("resumeItem", () => {
    it("sets plan agent back to running and sends prompt.send", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));

      useWorkflowStore.getState().resumeItem(PLAN_KEY);

      expect(getAgent(PLAN_KEY)!.status).toBe("running");
      const sent = ws.sent.find(s => JSON.parse(s).action === "prompt.send");
      expect(sent).toBeDefined();
      const envelope = JSON.parse(sent!);
      expect(envelope.payload.agent_slot).toEqual({ type: "plan" });
      expect(envelope.payload.text).toBe("");
    });

    it("sets active agent back to running and updates queue", () => {
      connectStore();
      setAgent("qi:7", makeAgentSession({ sessionId: 70, status: "paused" }));
      useWorkflowStore.setState({
        queue: [{ id: 7, status: "paused", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 70, result: null }],
      });

      useWorkflowStore.getState().resumeItem("qi:7");

      expect(getAgent("qi:7")!.status).toBe("running");
      expect(useWorkflowStore.getState().queue[0].status).toBe("running");
    });
  });

  describe("sendPromptToAgent", () => {
    it("sets paused plan agent back to running and appends user message", () => {
      connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));

      useWorkflowStore.getState().sendPromptToAgent(PLAN_KEY, "continue please");

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.status).toBe("running");
      expect(plan.blocks.length).toBe(1);
      expect(plan.blocks[0]).toMatchObject({ type: "user_message", content: "continue please" });
    });

    it("sets paused active agent back to running and updates queue", () => {
      connectStore();
      setAgent("qi:3", makeAgentSession({ sessionId: 30, status: "paused" }));
      useWorkflowStore.setState({
        queue: [{ id: 3, status: "paused", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 30, result: null }],
      });

      useWorkflowStore.getState().sendPromptToAgent("qi:3", "go on");

      expect(getAgent("qi:3")!.status).toBe("running");
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
      return { id: 1, queue_item_id: null, status: "completed", agent_type: null, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0, ...overrides };
    }

    it("routes plan agent_type to plan slot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 10, agent_type: "plan", status: "paused" })] }),
      );

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.sessionId).toBe(10);
      expect(plan!.status).toBe("paused");
    });

    it("routes prd agent_type to prd slot", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 20, agent_type: "prd" })] }),
      );

      const prd = getAgent(PRD_KEY);
      expect(prd).toBeDefined();
      expect(prd!.sessionId).toBe(20);
    });

    it("routes session agent_type to agents with session:id key", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 30, agent_type: "session" })] }),
      );

      expect(getAgent("session:30")).toBeDefined();
      expect(getAgent("session:30")!.sessionId).toBe(30);
    });

    it("routes review-fixer agent_type to agents with review-fixer:id key", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 40, agent_type: "review-fixer" })] }),
      );

      expect(getAgent("review-fixer:40")).toBeDefined();
      expect(getAgent("review-fixer:40")!.sessionId).toBe(40);
    });

    it("routes sessions with queue_item_id to agents by qi:id", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          agent_sessions: [makeSessionSummary({ id: 50, queue_item_id: 99, agent_type: "execute" })],
          queue: [{ id: 99, item_type: "execute", phase_id: null, phase_title: null, status: "running", order_index: 0, group_index: null, agent_session_id: 50, result: null }],
        }),
      );

      expect(getAgent("qi:99")).toBeDefined();
      expect(getAgent("qi:99")!.sessionId).toBe(50);
    });

    it("uses type:id key for unknown agent_type without queue_item_id", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 7, agent_type: "unknown_type" })] }),
      );

      expect(getAgent("unknown_type:7")).toBeDefined();
      expect(getAgent("unknown_type:7")!.sessionId).toBe(7);
    });

    it("multiple session agents each get unique keys", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          agent_sessions: [
            makeSessionSummary({ id: 60, agent_type: "session" }),
            makeSessionSummary({ id: 61, agent_type: "session" }),
            makeSessionSummary({ id: 3, agent_type: "some_custom" }),
          ],
        }),
      );

      const { agents } = useWorkflowStore.getState();
      expect(agents.has("session:60")).toBe(true);
      expect(agents.get("session:60")!.sessionId).toBe(60);
      expect(agents.has("session:61")).toBe(true);
      expect(agents.get("session:61")!.sessionId).toBe(61);
      expect(agents.has("some_custom:3")).toBe(true);
      expect(agents.get("some_custom:3")!.sessionId).toBe(3);
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

      expect(getAgent(PLAN_KEY)!.historyLoaded).toBe(false);
      expect(getAgent(PLAN_KEY)!.blocks).toEqual([]);
      expect(getAgent("qi:5")!.historyLoaded).toBe(false);
      expect(getAgent("qi:5")!.blocks).toEqual([]);
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

      const { agents } = useWorkflowStore.getState();
      expect(agents.has(PLAN_KEY)).toBe(true);
      expect(agents.has(PRD_KEY)).toBe(true);
      expect(agents.has("session:3")).toBe(true);
      expect(agents.has("qi:10")).toBe(true);
    });

    it("merges non-queue agent sessions when WS has already delivered queue data", () => {
      const wsQueue = [
        { id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "running" as const, order_index: 0, group_index: null, agent_session_id: 20, result: null },
      ];
      useWorkflowStore.setState({ queue: wsQueue, hydrated: false });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          workflow_status: "building",
          agent_sessions: [
            makeSessionSummary({ id: 20, queue_item_id: 5, agent_type: "execute", status: "running" }),
            makeSessionSummary({ id: 30, agent_type: "session", status: "paused" }),
          ],
          queue: wsQueue,
        }),
      );

      const { agents } = useWorkflowStore.getState();
      expect(agents.has("session:30")).toBe(true);
      expect(agents.get("session:30")!.sessionId).toBe(30);
      expect(agents.get("session:30")!.status).toBe("paused");
      expect(useWorkflowStore.getState().queue).toBe(wsQueue);
      expect(useWorkflowStore.getState().hydrated).toBe(true);
    });

    it("preserves WS-delivered agents when snapshot has same session", () => {
      const wsAgent = { sessionId: 20, blocks: [{ type: "text" as const, content: "ws data" }], status: "running" as const } as AgentSessionState;
      const agents = new Map<string, AgentSessionState>([["qi:5", wsAgent]]);
      useWorkflowStore.setState({ agents, hydrated: false });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          agent_sessions: [
            makeSessionSummary({ id: 20, queue_item_id: 5, agent_type: "execute", status: "running" }),
          ],
        }),
      );

      expect(useWorkflowStore.getState().agents.get("qi:5")).toBe(wsAgent);
    });

    it("preserves WS-delivered workflowStatus when not idle", () => {
      useWorkflowStore.setState({ queue: [{ id: 1 }] as never[], workflowStatus: "building", hydrated: false });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ workflow_status: "idle" }),
      );

      expect(useWorkflowStore.getState().workflowStatus).toBe("building");
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

    it("hydrates worktree setup_log from snapshot", () => {
      useWorkflowStore.setState({ hydrated: false, worktreeStatus: "idle", worktreeSetupOutput: [] });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          worktree: { path: "/tmp/wt", branch: "feat-123", status: "ready", setup_log: "line1\nline2\nline3" },
        }),
      );

      expect(useWorkflowStore.getState().worktreeSetupOutput).toEqual(["line1", "line2", "line3"]);
    });

    it("leaves worktreeSetupOutput empty when snapshot has no setup_log", () => {
      useWorkflowStore.setState({ hydrated: false, worktreeStatus: "idle", worktreeSetupOutput: [] });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({
          worktree: { path: "/tmp/wt", branch: "feat-123", status: "ready" },
        }),
      );

      expect(useWorkflowStore.getState().worktreeSetupOutput).toEqual([]);
    });

    it("leaves worktree as idle when snapshot has no worktree", () => {
      useWorkflowStore.setState({ hydrated: false, worktreeStatus: "idle", worktreePath: null, worktreeBranch: null });

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ worktree: null }),
      );

      const state = useWorkflowStore.getState();
      expect(state.worktreeStatus).toBe("idle");
      expect(state.worktreePath).toBeNull();
      expect(state.worktreeBranch).toBeNull();
    });
    it("merges REST blocks from agentState into hydrated agents", () => {
      const agentState = {
        sessions: [{
          sessionDbId: 10,
          agentType: "plan",
          status: "paused",
          subprocessId: null,
          model: null,
          blocks: [{ id: "b1", type: "text", content: "hello from REST", childBlocks: [] }],
          maxMessageId: 1,
          isIncremental: false,
          pendingQuestions: null,
          hasFileChanges: false,
          resumable: true,
          runtimeSessionId: null,
          runId: null,
          phaseId: null,
          pendingPermission: null,
          inputTokens: 10,
          outputTokens: 20,
          contextWindow: 200000,
          wasCompacted: false,
          draftPrompt: null,
          hasMore: false,
          oldestMessageId: 1,
        }],
      };

      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 10, agent_type: "plan", status: "paused" })] }),
        agentState as never,
      );

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.historyLoaded).toBe(true);
      expect(plan.blocks.length).toBe(1);
      expect(plan.blocks[0].content).toBe("hello from REST");
    });

    it("sets historyLoaded false when no agentState provided", () => {
      useWorkflowStore.getState().hydrateFromSnapshot(
        makeSnapshot({ agent_sessions: [makeSessionSummary({ id: 10, agent_type: "plan", status: "paused" })] }),
      );

      expect(getAgent(PLAN_KEY)!.historyLoaded).toBe(false);
      expect(getAgent(PLAN_KEY)!.blocks).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // populateAgentBlocks
  // -------------------------------------------------------------------------

  describe("populateAgentBlocks", () => {
    const fakeBlocks = [{ type: "text" as const, content: "hello" }];

    it("populates blocks for a plan agent", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [],
        agent_sessions: [{ id: 10, agent_type: "plan", status: "paused", queue_item_id: null, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      expect(getAgent(PLAN_KEY)!.blocks).toEqual([]);

      useWorkflowStore.getState().populateAgentBlocks(PLAN_KEY, fakeBlocks as never[]);

      expect(getAgent(PLAN_KEY)!.blocks).toEqual(fakeBlocks);
      expect(getAgent(PLAN_KEY)!.historyLoaded).toBe(true);
    });

    it("populates blocks for a prd agent", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [],
        agent_sessions: [{ id: 20, agent_type: "prd", status: "paused", queue_item_id: null, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.getState().populateAgentBlocks(PRD_KEY, fakeBlocks as never[]);

      expect(getAgent(PRD_KEY)!.blocks).toEqual(fakeBlocks);
      expect(getAgent(PRD_KEY)!.historyLoaded).toBe(true);
    });

    it("populates blocks for a queue-based agent", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 99, item_type: "execute", phase_id: null, phase_title: null, status: "paused", order_index: 0, group_index: null, agent_session_id: 50, result: null }],
        agent_sessions: [{ id: 50, agent_type: "execute", status: "paused", queue_item_id: 99, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.getState().populateAgentBlocks("qi:99", fakeBlocks as never[]);

      expect(getAgent("qi:99")!.blocks).toEqual(fakeBlocks);
      expect(getAgent("qi:99")!.historyLoaded).toBe(true);
    });

    it("does not overwrite if historyLoaded is already true", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [],
        agent_sessions: [{ id: 10, agent_type: "plan", status: "paused", queue_item_id: null, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.getState().populateAgentBlocks(PLAN_KEY, fakeBlocks as never[]);
      useWorkflowStore.getState().populateAgentBlocks(PLAN_KEY, [{ type: "text", content: "overwrite" }] as never[]);

      expect(getAgent(PLAN_KEY)!.blocks).toEqual(fakeBlocks);
    });

    it("does not overwrite if blocks are already non-empty", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "running", order_index: 0, group_index: null, agent_session_id: 30, result: null }],
        agent_sessions: [{ id: 30, agent_type: "execute", status: "running", queue_item_id: 5, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      // Simulate real-time blocks arriving via WS before populate
      useWorkflowStore.setState((state) => {
        const agents = new Map(state.agents);
        const agent = agents.get("qi:5")!;
        agents.set("qi:5", { ...agent, blocks: [{ type: "text", content: "live" }] as never[] });
        return { agents };
      });

      useWorkflowStore.getState().populateAgentBlocks("qi:5", fakeBlocks as never[]);

      expect(getAgent("qi:5")!.blocks).toEqual([{ type: "text", content: "live" }]);
    });

    it("sets pagination metadata even when blocks already exist", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "running", order_index: 0, group_index: null, agent_session_id: 30, result: null }],
        agent_sessions: [{ id: 30, agent_type: "execute", status: "running", queue_item_id: 5, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.setState((state) => {
        const agents = new Map(state.agents);
        const agent = agents.get("qi:5")!;
        agents.set("qi:5", { ...agent, blocks: [{ type: "text", content: "live" }] as never[] });
        return { agents };
      });

      useWorkflowStore.getState().populateAgentBlocks("qi:5", fakeBlocks as never[], true, 42);

      const agent = getAgent("qi:5")!;
      expect(agent.blocks).toEqual([{ type: "text", content: "live" }]);
      expect(agent.hasMore).toBe(true);
      expect(agent.oldestMessageId).toBe(42);
      expect(agent.historyLoaded).toBe(true);
    });

    it("skips state update when pagination metadata unchanged", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "running", order_index: 0, group_index: null, agent_session_id: 30, result: null }],
        agent_sessions: [{ id: 30, agent_type: "execute", status: "running", queue_item_id: 5, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      useWorkflowStore.getState().populateAgentBlocks("qi:5", fakeBlocks as never[], true, 42);
      const stateAfterFirst = useWorkflowStore.getState();

      useWorkflowStore.getState().populateAgentBlocks("qi:5", fakeBlocks as never[], true, 42);
      const stateAfterSecond = useWorkflowStore.getState();

      expect(stateAfterSecond.agents).toBe(stateAfterFirst.agents);
    });

    it("is a no-op when agent does not exist", () => {
      const before = useWorkflowStore.getState();
      useWorkflowStore.getState().populateAgentBlocks("qi:999", fakeBlocks as never[]);
      const after = useWorkflowStore.getState();
      expect(after.agents).toBe(before.agents);
    });

    it("sets hasFileChanges when history blocks contain a Write tool_call", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 5, item_type: "execute", phase_id: null, phase_title: null, status: "completed", order_index: 0, group_index: null, agent_session_id: 30, result: null }],
        agent_sessions: [{ id: 30, agent_type: "execute", status: "completed", queue_item_id: 5, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      const blocksWithWrite = [
        { type: "text" as const, content: "thinking..." },
        { type: "tool_call" as const, content: "", toolName: "Write", toolArgs: "{}" },
      ];
      useWorkflowStore.getState().populateAgentBlocks("qi:5", blocksWithWrite as never[]);

      expect(getAgent("qi:5")!.hasFileChanges).toBe(true);
    });

    it("sets hasFileChanges when history blocks contain an Edit tool_call", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 6, item_type: "execute", phase_id: null, phase_title: null, status: "completed", order_index: 0, group_index: null, agent_session_id: 31, result: null }],
        agent_sessions: [{ id: 31, agent_type: "execute", status: "completed", queue_item_id: 6, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      const blocksWithEdit = [
        { type: "tool_call" as const, content: "", toolName: "Edit", toolArgs: "{}" },
      ];
      useWorkflowStore.getState().populateAgentBlocks("qi:6", blocksWithEdit as never[]);

      expect(getAgent("qi:6")!.hasFileChanges).toBe(true);
    });

    it("sets hasFileChanges when a file-change tool is in childBlocks", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 7, item_type: "execute", phase_id: null, phase_title: null, status: "completed", order_index: 0, group_index: null, agent_session_id: 32, result: null }],
        agent_sessions: [{ id: 32, agent_type: "execute", status: "completed", queue_item_id: 7, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      const blocksWithNestedEdit = [
        {
          type: "tool_call" as const, content: "", toolName: "Agent", toolArgs: "{}",
          childBlocks: [
            { type: "tool_call" as const, content: "", toolName: "NotebookEdit", toolArgs: "{}" },
          ],
        },
      ];
      useWorkflowStore.getState().populateAgentBlocks("qi:7", blocksWithNestedEdit as never[]);

      expect(getAgent("qi:7")!.hasFileChanges).toBe(true);
    });

    it("does not set hasFileChanges when no file-change tools in blocks", () => {
      useWorkflowStore.getState().hydrateFromSnapshot({
        workflow_status: "building",
        queue: [{ id: 8, item_type: "execute", phase_id: null, phase_title: null, status: "completed", order_index: 0, group_index: null, agent_session_id: 33, result: null }],
        agent_sessions: [{ id: 33, agent_type: "execute", status: "completed", queue_item_id: 8, runtime_session_id: null, input_tokens: 0, output_tokens: 0, context_window: 0 }],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      });

      const blocksNoFileChange = [
        { type: "text" as const, content: "hello" },
        { type: "tool_call" as const, content: "", toolName: "Read", toolArgs: "{}" },
      ];
      useWorkflowStore.getState().populateAgentBlocks("qi:8", blocksNoFileChange as never[]);

      expect(getAgent("qi:8")!.hasFileChanges).toBe(false);
    });
  });

  // -- agent_paused (reconnect resume support) --

  describe("agent_paused", () => {
    it("creates plan agent in paused state with runtimeSessionId on reconnect", () => {
      const ws = connectStore();
      expect(getAgent(PLAN_KEY)).toBeUndefined();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: -1,
          session_id: 42,
          agent_type: "plan",
          runtime_session_id: "cc-sess-abc",
        },
      });

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.status).toBe("paused");
      expect(plan!.sessionId).toBe(42);
      expect(plan!.runtimeSessionId).toBe("cc-sess-abc");
    });

    it("preserves existing plan agent blocks when paused", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ sessionId: 42, blocks: [{ type: "text", content: "hello" }] }) as never);

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: -1,
          session_id: 42,
          agent_type: "plan",
          runtime_session_id: "cc-sess-xyz",
        },
      });

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.status).toBe("paused");
      expect(plan.runtimeSessionId).toBe("cc-sess-xyz");
      expect(plan.blocks).toHaveLength(1);
    });

    it("creates prd agent in paused state on reconnect", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          queue_item_id: -2,
          session_id: 99,
          agent_type: "prd",
          runtime_session_id: "cc-prd-sess",
        },
      });

      const prd = getAgent(PRD_KEY);
      expect(prd).toBeDefined();
      expect(prd!.status).toBe("paused");
      expect(prd!.runtimeSessionId).toBe("cc-prd-sess");
    });

    it("creates agent in paused state for session slot", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: {
          feature_id: 1,
          agent_slot: { type: "session" },
          session_id: 55,
          agent_type: "session",
          runtime_session_id: "cc-session-id",
        },
      });

      const agent = getAgent("session:55");
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("paused");
      expect(agent!.runtimeSessionId).toBe("cc-session-id");
    });
  });

  // -- agent_session_id (session ID capture during streaming) --

  describe("agent_session_id", () => {
    it("sets runtimeSessionId on existing plan agent", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ sessionId: 10 }));

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: -1,
          session_id: 10,
          runtime_session_id: "captured-uuid",
        },
      });

      expect(getAgent(PLAN_KEY)!.runtimeSessionId).toBe("captured-uuid");
    });

    it("is a no-op when plan agent does not exist", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: -1,
          session_id: 10,
          runtime_session_id: "captured-uuid",
        },
      });

      expect(getAgent(PLAN_KEY)).toBeUndefined();
    });

    it("sets runtimeSessionId on existing active agent", () => {
      const ws = connectStore();
      setAgent("qi:7", makeAgentSession({ sessionId: 7 }));

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: 7,
          session_id: 7,
          runtime_session_id: "active-uuid",
        },
      });

      expect(getAgent("qi:7")!.runtimeSessionId).toBe("active-uuid");
    });

    it("ignores empty runtime_session_id", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ sessionId: 10 }));

      dispatch(ws, {
        domain: "workflow",
        action: "agent_session_id",
        payload: {
          queue_item_id: -1,
          session_id: 10,
          runtime_session_id: "",
        },
      });

      expect(getAgent(PLAN_KEY)!.runtimeSessionId).toBeNull();
    });
  });

  // -- hydrateFromSnapshot includes runtimeSessionId --

  describe("hydrateFromSnapshot with runtimeSessionId", () => {
    it("hydrates plan agent with runtime_session_id from snapshot", () => {
      const snapshot: FeatureSnapshot = {
        workflow_status: "planning",
        queue: [],
        agent_sessions: [
          { id: 100, agent_type: "plan", status: "paused", queue_item_id: null, runtime_session_id: "snap-uuid" } as AgentSessionSummary,
        ],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      };

      useWorkflowStore.getState().hydrateFromSnapshot(snapshot);

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.runtimeSessionId).toBe("snap-uuid");
      expect(plan!.status).toBe("paused");
    });

    it("hydrates agent with null runtime_session_id when not present", () => {
      const snapshot: FeatureSnapshot = {
        workflow_status: "planning",
        queue: [],
        agent_sessions: [
          { id: 101, agent_type: "plan", status: "completed", queue_item_id: null, runtime_session_id: null } as AgentSessionSummary,
        ],
        plan: null,
        worktree: null,
        autonomy_level: 3,
      };

      useWorkflowStore.getState().hydrateFromSnapshot(snapshot);

      expect(getAgent(PLAN_KEY)!.runtimeSessionId).toBeNull();
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

      connectStore(2);
      expect(useWorkflowStore.getState().featureTitle).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // agent_user_message
  // -------------------------------------------------------------------------

  describe("agent_user_message", () => {
    it("adds user_message block to plan agent", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -1, session_id: 10, content: "Create a plan for auth" },
      });

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0]).toMatchObject({ type: "user_message", content: "Create a plan for auth" });
    });

    it("adds user_message block to prd agent", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -2, session_id: 20, content: "PRD for feature X" },
      });

      const prd = getAgent(PRD_KEY)!;
      expect(prd.blocks).toHaveLength(1);
      expect(prd.blocks[0]).toMatchObject({ type: "user_message", content: "PRD for feature X" });
    });

    it("adds user_message block to queue item agent", () => {
      const ws = connectStore();
      setAgent("qi:42", makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: 42, session_id: 30, content: "Implement the phase" },
      });

      const agent = getAgent("qi:42")!;
      expect(agent.blocks).toHaveLength(1);
      expect(agent.blocks[0]).toMatchObject({ type: "user_message", content: "Implement the phase" });
    });

    it("creates plan agent on the fly if not yet initialized", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -1, session_id: 10, content: "Plan this" },
      });

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.blocks).toHaveLength(1);
      expect(plan!.blocks[0]).toMatchObject({ type: "user_message", content: "Plan this" });
    });

    it("creates agent on the fly for queue items", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: 99, session_id: 50, content: "Execute phase" },
      });

      const agent = getAgent("qi:99");
      expect(agent).toBeDefined();
      expect(agent!.blocks).toHaveLength(1);
      expect(agent!.blocks[0]).toMatchObject({ type: "user_message", content: "Execute phase" });
    });

    it("ignores agent_user_message with empty content", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "agent_user_message",
        payload: { queue_item_id: -1, session_id: 10, content: "" },
      });

      expect(getAgent(PLAN_KEY)!.blocks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Plan approval flow
  // -------------------------------------------------------------------------

  describe("plan approval flow", () => {
    it("plan_ready sets plan agent to paused", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "running" }));

      dispatch(ws, {
        domain: "workflow",
        action: "plan_ready",
        payload: { feature_id: 1 },
      });

      const state = useWorkflowStore.getState();
      expect(getAgent(PLAN_KEY)!.status).toBe("paused");
      expect(state.workflowStatus).toBe("plan_approval");
    });

    it("prd_ready sets prd agent to paused", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "running" }));

      dispatch(ws, {
        domain: "workflow",
        action: "prd_ready",
        payload: { feature_id: 1 },
      });

      expect(getAgent(PRD_KEY)!.status).toBe("paused");
    });

    it("approvePlan sends message without optimistic state update", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      useWorkflowStore.getState().approvePlan("req-1");

      expect(getAgent(PLAN_KEY)!.status).toBe("paused");
      expect(useWorkflowStore.getState().workflowStatus).toBe("plan_approval");
      const sent = ws.sent.find(s => JSON.parse(s).action === "plan.approved");
      expect(sent).toBeDefined();
      expect(JSON.parse(sent!).payload.request_id).toBe("req-1");
    });

    it("rejectPlan sends message without optimistic state update", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      useWorkflowStore.getState().rejectPlan("needs more detail", "req-2");

      expect(getAgent(PLAN_KEY)!.status).toBe("paused");
      const sent = ws.sent.find(s => JSON.parse(s).action === "plan.rejected");
      expect(sent).toBeDefined();
      const envelope = JSON.parse(sent!);
      expect(envelope.payload.feedback).toBe("needs more detail");
      expect(envelope.payload.request_id).toBe("req-2");
    });

    it("approvePlan is safe when plan agent is null", () => {
      connectStore();

      useWorkflowStore.getState().approvePlan();

      expect(getAgent(PLAN_KEY)).toBeUndefined();
      expect(useWorkflowStore.getState().workflowStatus).toBe("idle");
    });

    it("approvePlan sends prd.approved when workflowStatus is prd", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      useWorkflowStore.getState().approvePlan("req-prd-1");

      const sent = ws.sent.find(s => JSON.parse(s).action === "prd.approved");
      expect(sent).toBeDefined();
      expect(JSON.parse(sent!).payload.request_id).toBe("req-prd-1");
      const planSent = ws.sent.find(s => JSON.parse(s).action === "plan.approved");
      expect(planSent).toBeUndefined();
    });

    it("approvePlan adds user_message to prd agent when workflowStatus is prd", () => {
      connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      useWorkflowStore.getState().approvePlan();

      const prd = getAgent(PRD_KEY)!;
      expect(prd.blocks).toHaveLength(1);
      expect(prd.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("PRD") });
    });

    it("approvePlan adds user_message to plan agent when workflowStatus is plan_approval", () => {
      connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      useWorkflowStore.getState().approvePlan();

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("Plan") });
    });

    it("rejectPlan sends prd.rejected when workflowStatus is prd", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      useWorkflowStore.getState().rejectPlan("needs work", "req-prd-2");

      const sent = ws.sent.find(s => JSON.parse(s).action === "prd.rejected");
      expect(sent).toBeDefined();
    });

    it("rejectPlan adds user_message to prd agent when workflowStatus is prd", () => {
      connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      useWorkflowStore.getState().rejectPlan("more detail please");

      const prd = getAgent(PRD_KEY)!;
      expect(prd.blocks).toHaveLength(1);
      expect(prd.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("PRD") });
    });

    it("rejectPlan adds user_message to plan agent when workflowStatus is plan_approval", () => {
      connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      useWorkflowStore.getState().rejectPlan("needs more detail");

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0]).toMatchObject({ type: "user_message", content: expect.stringContaining("Plan") });
    });

    it("rejectPlan with empty feedback skips user_message block", () => {
      connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      useWorkflowStore.getState().rejectPlan("", "req-3");

      expect(getAgent(PLAN_KEY)!.blocks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // status_changed — agent status resets
  // -------------------------------------------------------------------------

  describe("status_changed agent resets", () => {
    it("resets plan agent status to running when leaving plan_approval", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "plan_approval", status: "planning" },
      });

      expect(getAgent(PLAN_KEY)!.status).toBe("running");
      expect(useWorkflowStore.getState().workflowStatus).toBe("planning");
    });

    it("does not reset plan agent when staying in plan_approval", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "plan_approval" });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "plan_approval", status: "plan_approval" },
      });

      expect(getAgent(PLAN_KEY)!.status).toBe("paused");
    });

    it("sets prd agent back to running when transitioning from prd to planning", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "prd", status: "planning" },
      });

      expect(getAgent(PRD_KEY)!.status).toBe("running");
      expect(useWorkflowStore.getState().workflowStatus).toBe("planning");
    });

    it("does not reset prd agent when prd transitions to non-planning status", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "paused" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "prd", status: "error" },
      });

      expect(getAgent(PRD_KEY)!.status).toBe("paused");
    });

    it("does not reset prd agent if it is not paused", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "running" }));
      useWorkflowStore.setState({ workflowStatus: "prd" });

      dispatch(ws, {
        domain: "workflow",
        action: "status_changed",
        payload: { previous_status: "prd", status: "planning" },
      });

      expect(getAgent(PRD_KEY)!.status).toBe("running");
    });
  });

  // -------------------------------------------------------------------------
  // item_completed / item_error
  // -------------------------------------------------------------------------

  describe("item_completed and item_error", () => {
    it("item_completed sets plan agent to completed", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "running" }));

      dispatch(ws, {
        domain: "workflow",
        action: "item_completed",
        payload: { queue_item_id: -1, feature_id: 1 },
      });

      expect(getAgent(PLAN_KEY)!.status).toBe("completed");
    });

    it("item_completed sets prd agent to completed", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession({ status: "running" }));

      dispatch(ws, {
        domain: "workflow",
        action: "item_completed",
        payload: { queue_item_id: -2, feature_id: 1 },
      });

      expect(getAgent(PRD_KEY)!.status).toBe("completed");
    });

    it("item_completed sets active agent to completed and updates queue", () => {
      const ws = connectStore();
      setAgent("qi:10", makeAgentSession({ status: "running" }));
      useWorkflowStore.setState({
        queue: [{ id: 10, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 100, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "item_completed",
        payload: { queue_item_id: 10, feature_id: 1 },
      });

      expect(getAgent("qi:10")!.status).toBe("completed");
      expect(useWorkflowStore.getState().queue[0].status).toBe("completed");
    });

    it("item_error sets plan agent to error", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ status: "running" }));

      dispatch(ws, {
        domain: "workflow",
        action: "item_error",
        payload: { queue_item_id: -1, error: "something broke", feature_id: 1 },
      });

      expect(getAgent(PLAN_KEY)!.status).toBe("error");
    });

    it("item_error sets active agent to error and updates queue", () => {
      const ws = connectStore();
      setAgent("qi:5", makeAgentSession({ status: "running" }));
      useWorkflowStore.setState({
        queue: [{ id: 5, status: "running", item_type: "execute", phase_id: null, phase_title: null, order_index: 0, group_index: null, agent_session_id: 50, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "item_error",
        payload: { queue_item_id: 5, error: "timeout", feature_id: 1 },
      });

      expect(getAgent("qi:5")!.status).toBe("error");
      expect(useWorkflowStore.getState().queue[0].status).toBe("error");
      expect(useWorkflowStore.getState().error).toBe("timeout");
    });
  });

  // -------------------------------------------------------------------------
  // plan_content / prd_content
  // -------------------------------------------------------------------------

  describe("plan_content", () => {
    it("injects tool_call block with __show_plan toolName", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "plan_content",
        payload: { content: "# My Plan\n- Phase 1\n- Phase 2" },
      });

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0]).toMatchObject({ type: "tool_call", toolName: "__show_plan" });
      const args = JSON.parse((plan.blocks[0] as { toolArgs: string }).toolArgs);
      expect(args.plan).toBe("# My Plan\n- Phase 1\n- Phase 2");
    });

    it("creates plan agent on the fly if null", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "plan_content",
        payload: { content: "Plan text" },
      });

      expect(getAgent(PLAN_KEY)).toBeDefined();
      expect(getAgent(PLAN_KEY)!.blocks).toHaveLength(1);
    });

    it("ignores plan_content with empty content", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "plan_content",
        payload: { content: "" },
      });

      expect(getAgent(PLAN_KEY)!.blocks).toHaveLength(0);
    });
  });

  describe("prd_content", () => {
    it("injects tool_call block with __show_prd toolName", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "prd_content",
        payload: { content: "# PRD\n- Requirement 1" },
      });

      const prd = getAgent(PRD_KEY)!;
      expect(prd.blocks).toHaveLength(1);
      expect(prd.blocks[0]).toMatchObject({ type: "tool_call", toolName: "__show_prd" });
    });

    it("creates prd agent on the fly if null", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "prd_content",
        payload: { content: "PRD text" },
      });

      expect(getAgent(PRD_KEY)).toBeDefined();
      expect(getAgent(PRD_KEY)!.blocks).toHaveLength(1);
    });

    it("ignores prd_content with empty content", () => {
      const ws = connectStore();
      setAgent(PRD_KEY, makeAgentSession());

      dispatch(ws, {
        domain: "workflow",
        action: "prd_content",
        payload: { content: "" },
      });

      expect(getAgent(PRD_KEY)!.blocks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // feature.updated
  // -------------------------------------------------------------------------

  describe("feature.updated", () => {
    it("calls invalidateFeatureQueries for feature.updated events", () => {
      const ws = connectStore(42);

      dispatch(ws, {
        domain: "feature",
        action: "updated",
        payload: { feature_id: 42, changed: ["phases", "progress"] },
      });

      expect(useWorkflowStore.getState().workflowStatus).toBe("idle");
    });
  });

  // -------------------------------------------------------------------------
  // Block preservation across started events
  // -------------------------------------------------------------------------

  describe("block preservation on started events", () => {
    it("session.started migrates placeholder blocks to unique key", () => {
      const ws = connectStore();
      // Simulate user message arriving before session.started (at placeholder key)
      setAgent("session", makeAgentSession({
        blocks: [{ type: "user_message", content: "Hello" }],
      }));

      dispatch(ws, {
        domain: "workflow",
        action: "session.started",
        payload: { feature_id: 1, session_id: 77 },
      });

      // Agent should be at unique key, not at placeholder
      expect(getAgent("session")).toBeUndefined();
      const agent = getAgent("session:77");
      expect(agent).toBeDefined();
      expect(agent!.sessionId).toBe(77);
      expect(agent!.blocks).toHaveLength(1);
      expect(agent!.blocks[0]).toMatchObject({ type: "user_message", content: "Hello" });
    });

    it("session.started merges placeholder and existing agent blocks", () => {
      const ws = connectStore();
      // Placeholder with user message
      setAgent("session", makeAgentSession({
        blocks: [{ type: "user_message", content: "Hello" }],
      }));
      // Existing agent at session:77 from agent_user_message arriving first
      setAgent("session:77", makeAgentSession({
        sessionId: 77,
        blocks: [{ type: "text", content: "stream output" }],
      }));
      useWorkflowStore.setState({ startingSession: true });

      dispatch(ws, {
        domain: "workflow",
        action: "session.started",
        payload: { feature_id: 1, session_id: 77 },
      });

      expect(getAgent("session")).toBeUndefined();
      const agent = getAgent("session:77");
      expect(agent).toBeDefined();
      expect(agent!.blocks).toHaveLength(2);
      expect(agent!.blocks[0]).toMatchObject({ type: "user_message", content: "Hello" });
      expect(agent!.blocks[1]).toMatchObject({ type: "text", content: "stream output" });
    });

    it("session.started clears startingSession flag", () => {
      const ws = connectStore();
      useWorkflowStore.setState({ startingSession: true });

      dispatch(ws, {
        domain: "workflow",
        action: "session.started",
        payload: { feature_id: 1, session_id: 88 },
      });

      expect(useWorkflowStore.getState().startingSession).toBe(false);
    });

    it("startSession clears flag and sets error when WS is disconnected", () => {
      connectStore();
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.readyState = WebSocket.CLOSED;

      useWorkflowStore.getState().startSession("test", undefined);

      expect(useWorkflowStore.getState().startingSession).toBe(false);
      expect(useWorkflowStore.getState().error).toContain("Not connected");
    });

    it("queue_update before item_started populates queue so agent is matched", () => {
      const ws = connectStore();

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

      expect(useWorkflowStore.getState().queue).toHaveLength(1);

      dispatch(ws, {
        domain: "workflow",
        action: "item_started",
        payload: { feature_id: 1, queue_item_id: 10, session_id: 55, item_type: "execute" },
      });

      const agent = getAgent("qi:10");
      expect(agent).toBeDefined();
      expect(agent!.sessionId).toBe(55);

      const queueItem = useWorkflowStore.getState().queue.find((q) => q.id === 10);
      expect(queueItem?.status).toBe("running");
    });

    it("item_started preserves existing blocks", () => {
      const ws = connectStore();
      setAgent("qi:10", makeAgentSession({
        blocks: [{ type: "user_message", content: "Execute this" }],
      }));
      useWorkflowStore.setState({
        queue: [{ id: 10, status: "ready", item_type: "execute", phase_id: 1, phase_title: "P1", order_index: 0, group_index: 0, agent_session_id: null, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "item_started",
        payload: { feature_id: 1, queue_item_id: 10, session_id: 88, item_type: "execute" },
      });

      const agent = getAgent("qi:10");
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
      expect(ws.sent.length).toBeGreaterThan(0);
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.action).toBe("start_build");
    });

    it("continueWorkflow sets continuingBuild flag", () => {
      const ws = connectStore();
      useWorkflowStore.getState().continueWorkflow();
      expect(useWorkflowStore.getState().continuingBuild).toBe(true);
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

    it("startSession sets startingSession flag", () => {
      connectStore();
      useWorkflowStore.getState().startSession("do something", undefined);
      expect(useWorkflowStore.getState().startingSession).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // agent_running / agent_paused with AgentSlot format
  // -------------------------------------------------------------------------

  describe("agent_running with agent_slot", () => {
    it("routes to plan agent when slot is plan", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 100, agent_type: "plan" },
      });

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.status).toBe("running");
      expect(plan!.sessionId).toBe(100);
    });

    it("routes to prd agent when slot is prd", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "prd" }, session_id: 200, agent_type: "prd" },
      });

      const prd = getAgent(PRD_KEY);
      expect(prd).toBeDefined();
      expect(prd!.status).toBe("running");
      expect(prd!.sessionId).toBe(200);
    });

    it("routes to agents for queue items", () => {
      const ws = connectStore();
      useWorkflowStore.setState({
        queue: [{ id: 42, status: "ready", item_type: "execute", phase_id: 1, phase_title: "P1", order_index: 0, group_index: 0, agent_session_id: null, result: null }],
      });

      dispatch(ws, {
        domain: "workflow",
        action: "agent_running",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 42 }, session_id: 300, agent_type: "execute" },
      });

      const agent = getAgent("qi:42");
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
  });

  describe("agent_paused with agent_slot", () => {
    it("routes to plan agent with paused status and runtimeSessionId", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 42, agent_type: "plan", runtime_session_id: "cc-123" },
      });

      const plan = getAgent(PLAN_KEY);
      expect(plan).toBeDefined();
      expect(plan!.status).toBe("paused");
      expect(plan!.sessionId).toBe(42);
      expect(plan!.runtimeSessionId).toBe("cc-123");
    });

    it("routes to prd agent with paused status and runtimeSessionId", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "prd" }, session_id: 99, agent_type: "prd", runtime_session_id: "cc-prd" },
      });

      const prd = getAgent(PRD_KEY);
      expect(prd).toBeDefined();
      expect(prd!.status).toBe("paused");
      expect(prd!.runtimeSessionId).toBe("cc-prd");
    });

    it("routes to agents for queue items with paused status", () => {
      const ws = connectStore();

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "queue_item", id: 55 }, session_id: 400, agent_type: "execute", runtime_session_id: "cc-qi" },
      });

      const agent = getAgent("qi:55");
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("paused");
      expect(agent!.sessionId).toBe(400);
      expect(agent!.runtimeSessionId).toBe("cc-qi");
    });

    it("preserves existing agent blocks when paused", () => {
      const ws = connectStore();
      setAgent(PLAN_KEY, makeAgentSession({ sessionId: 42, blocks: [{ type: "text", content: "work" }] }) as never);

      dispatch(ws, {
        domain: "workflow",
        action: "agent_paused",
        payload: { feature_id: 1, agent_slot: { type: "plan" }, session_id: 42, agent_type: "plan", runtime_session_id: "cc-456" },
      });

      const plan = getAgent(PLAN_KEY)!;
      expect(plan.status).toBe("paused");
      expect(plan.runtimeSessionId).toBe("cc-456");
      expect(plan.blocks).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Permission request / respond
  // ---------------------------------------------------------------------------

  describe("permission.request and respondToPermission", () => {
    it("sets pendingPermission on a queue agent when permission.request arrives", () => {
      const ws = connectStore();
      setAgent("qi:7", makeAgentSession({ sessionId: 100 }));

      dispatch(ws, {
        domain: "workflow",
        action: "permission.request",
        payload: {
          feature_id: 1,
          agent_slot: { type: "queue_item", id: 7 },
          request_id: "req-1",
          tool_name: "Bash",
          tool_input: { command: "ls" },
          description: "Run ls",
          pattern: "Bash(/tmp:*)",
        },
      });

      const agent = getAgent("qi:7")!;
      expect(agent.pendingPermission).toEqual({
        toolName: "Bash",
        input: { command: "ls" },
        description: "Run ls",
        pattern: "Bash(/tmp:*)",
        preview: undefined,
        options: [],
        requestId: "req-1",
      });
    });

    it("clears pendingPermission when respondToPermission is called", () => {
      const ws = connectStore();
      setAgent("qi:7", makeAgentSession({
        sessionId: 100,
        pendingPermission: {
          toolName: "Bash",
          input: { command: "ls" },
          description: "Run ls",
          pattern: "Bash(/tmp:*)",
          requestId: "req-1",
        },
      }));

      useWorkflowStore.getState().respondToPermission("qi:7", "req-1", "allow_once");

      expect(getAgent("qi:7")!.pendingPermission).toBeNull();

      expect(ws.sent.length).toBeGreaterThanOrEqual(1);
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.action).toBe("permission.respond");
      expect(msg.payload.decision).toBe("allow_once");
    });
  });
});
