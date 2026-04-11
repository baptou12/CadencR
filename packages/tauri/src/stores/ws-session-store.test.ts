import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_MODEL } from "../shared/models";
import { useWsSessionStore, applyMutations, createStreamingState } from "./ws-session-store";
import { updateSession } from "./ws-session-types";

// --- Mock WebSocket ---

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.fireEvent("open"), 0);
  }

  addEventListener(event: string, cb: (...args: unknown[]) => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener() {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  fireEvent(event: string, data?: unknown) {
    for (const cb of this.listeners[event] ?? []) {
      cb(data ?? {});
    }
  }

  simulateMessage(envelope: { domain: string; action: string; payload: unknown }) {
    const raw = JSON.stringify({ id: "srv-1", ...envelope });
    this.fireEvent("message", { data: raw });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

Object.assign(MockWebSocket, { OPEN: 1, CONNECTING: 0, CLOSED: 3 });

beforeEach(() => {
  MockWebSocket.reset();
  useWsSessionStore.setState({ sessions: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("window", { ...globalThis.window });
});

function getWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

async function tick() {
  await new Promise((r) => setTimeout(r, 10));
}

describe("ws-session-store", () => {
  it("connect creates a WebSocket and sets isConnected on open", async () => {
    useWsSessionStore.getState().connect("s1");
    await tick();
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session).toBeDefined();
    expect(session.isConnected).toBe(true);
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("connect is a no-op if already connected", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    store.connect("s1");
    store.connect("s1");
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("connect creates new connection if previous was closed", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws1 = getWs();
    ws1.readyState = MockWebSocket.CLOSED;
    store.connect("s1");
    await tick();
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("disconnect closes the WebSocket and removes the session", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    store.disconnect("s1");
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(useWsSessionStore.getState().sessions["s1"]).toBeUndefined();
  });

  it("destroy sends destroy envelope and closes connection", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "srv-1" },
    });
    store.destroy("s1");
    const destroyMsg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(destroyMsg.action).toBe("destroy");
    expect(destroyMsg.payload.session_id).toBe("srv-1");
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(useWsSessionStore.getState().sessions["s1"].status).toBe("completed");
  });

  it("sendPrompt appends user message block and sets running", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "srv-1" },
    });
    store.sendPrompt("s1", "hello");
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.status).toBe("running");
    expect(session.blocks.length).toBe(1);
    expect(session.blocks[0].type).toBe("user_message");
    expect(session.blocks[0].content).toBe("hello");
  });

  it("setPersistedState sets blocks and status", () => {
    // Ensure session exists first
    useWsSessionStore.getState().connect("s1");
    const blocks = [{ id: "b1", type: "text" as const, content: "restored" }];
    useWsSessionStore.getState().setPersistedState("s1", { blocks, status: "completed" });
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.blocks).toEqual(blocks);
    expect(session.status).toBe("completed");
    expect(session.persistedLoaded).toBe(true);
  });

  it("claude_session_id action sets claudeSessionId on the session", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "srv-1" },
    });

    ws.simulateMessage({
      domain: "session",
      action: "claude_session_id",
      payload: { claude_session_id: "uuid-abc-123" },
    });

    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.claudeSessionId).toBe("uuid-abc-123");
  });

  it("claude_session_id dedup guard skips update when value unchanged", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "srv-1" },
    });

    ws.simulateMessage({
      domain: "session",
      action: "claude_session_id",
      payload: { claude_session_id: "uuid-abc-123" },
    });

    // Capture sessions reference after first set
    const sessionsAfterFirst = useWsSessionStore.getState().sessions;

    // Send the same value again
    ws.simulateMessage({
      domain: "session",
      action: "claude_session_id",
      payload: { claude_session_id: "uuid-abc-123" },
    });

    // Sessions object should be the same reference (no update triggered)
    const sessionsAfterSecond = useWsSessionStore.getState().sessions;
    expect(sessionsAfterSecond).toBe(sessionsAfterFirst);
    expect(sessionsAfterSecond["s1"].claudeSessionId).toBe("uuid-abc-123");
  });

  it("new session defaults currentModelId to DEFAULT_MODEL", async () => {
    useWsSessionStore.getState().connect("s1");
    await tick();
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.currentModelId).toBe(DEFAULT_MODEL);
  });

  it("initSession with model updates currentModelId in store", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    store.initSession("s1", { model: "claude-haiku-4-5-20251001" });
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.currentModelId).toBe("claude-haiku-4-5-20251001");
  });

  it("initSession without model keeps DEFAULT_MODEL", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    store.initSession("s1", { cwd: "/tmp" });
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.currentModelId).toBe(DEFAULT_MODEL);
  });

  it("session.initialized with model updates currentModelId from server", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    // Frontend sends settings model on init
    store.initSession("s1", { model: "opus[1m]" });
    expect(useWsSessionStore.getState().sessions["s1"].currentModelId).toBe("opus[1m]");

    // Server responds with the stored model from the DB (last used)
    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "42", model: "claude-haiku-4-5-20251001" },
    });
    expect(useWsSessionStore.getState().sessions["s1"].currentModelId).toBe("claude-haiku-4-5-20251001");
  });

  it("session.initialized without model keeps frontend model", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    store.initSession("s1", { model: "opus[1m]" });

    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "42" },
    });
    expect(useWsSessionStore.getState().sessions["s1"].currentModelId).toBe("opus[1m]");
  });

  it("setProvider waits for provider.set.ok before mutating local state", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "srv-1" },
    });

    useWsSessionStore.setState((state) => updateSession(state, "s1", { currentProviderId: "stale-provider" }));
    store.setProvider("s1", "claude_code");
    expect(useWsSessionStore.getState().sessions["s1"].currentProviderId).toBe("stale-provider");

    ws.simulateMessage({
      domain: "session",
      action: "provider.set.ok",
      payload: { provider: "claude_code" },
    });
    expect(useWsSessionStore.getState().sessions["s1"].currentProviderId).toBe("claude_code");
  });

  it("setModel waits for model.set.ok before mutating local state", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      payload: { session_id: "srv-1" },
    });

    useWsSessionStore.setState((state) => updateSession(state, "s1", { currentModelId: "opus[1m]" }));
    store.setModel("s1", "haiku");
    expect(useWsSessionStore.getState().sessions["s1"].currentModelId).toBe("opus[1m]");

    ws.simulateMessage({
      domain: "session",
      action: "model.set.ok",
      payload: { model: "haiku" },
    });
    expect(useWsSessionStore.getState().sessions["s1"].currentModelId).toBe("haiku");
  });

  it("sets hasFileChanges when Write tool_call block is received", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    expect(useWsSessionStore.getState().sessions["s1"].hasFileChanges).toBe(false);

    // Simulate an assistant message with a Write tool_use block
    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "tu-1", name: "Write", input: { file_path: "/tmp/test.ts", content: "hello" } },
              ],
            },
          },
        ],
      },
    });

    expect(useWsSessionStore.getState().sessions["s1"].hasFileChanges).toBe(true);
  });

  it("sets hasFileChanges for Edit and NotebookEdit tools", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "tu-2", name: "Edit", input: { file_path: "/tmp/test.ts" } },
              ],
            },
          },
        ],
      },
    });

    expect(useWsSessionStore.getState().sessions["s1"].hasFileChanges).toBe(true);
  });

  it("does not set hasFileChanges for non-file-changing tools", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "tu-3", name: "Read", input: { file_path: "/tmp/test.ts" } },
              ],
            },
          },
        ],
      },
    });

    expect(useWsSessionStore.getState().sessions["s1"].hasFileChanges).toBe(false);
  });

  it("resets hasFileChanges on cleared action", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    // Set hasFileChanges via a Write tool
    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "tu-4", name: "Write", input: { file_path: "/tmp/test.ts", content: "x" } },
              ],
            },
          },
        ],
      },
    });
    expect(useWsSessionStore.getState().sessions["s1"].hasFileChanges).toBe(true);

    // Clear session
    ws.simulateMessage({ domain: "session", action: "cleared", payload: {} });
    expect(useWsSessionStore.getState().sessions["s1"].hasFileChanges).toBe(false);
  });

  it("cleared action preserves existing blocks and appends clear_divider", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    // Add a message block
    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
        ],
      },
    });
    const blocksBefore = useWsSessionStore.getState().sessions["s1"].blocks;
    expect(blocksBefore.length).toBeGreaterThan(0);

    // Clear with previous_session_id
    ws.simulateMessage({
      domain: "session",
      action: "cleared",
      payload: { previous_session_id: "cli-sess-xyz" },
    });
    const session = useWsSessionStore.getState().sessions["s1"];
    // Blocks preserved + clear_divider appended
    expect(session.blocks.length).toBe(blocksBefore.length + 1);
    const lastBlock = session.blocks[session.blocks.length - 1];
    expect(lastBlock.type).toBe("clear_divider");
    expect(lastBlock.content).toBe("cli-sess-xyz");
    // claudeSessionId reset
    expect(session.claudeSessionId).toBe("");
    expect(session.status).toBe("idle");
  });

  it("extracts todos from TodoWrite tool_call in assistant message", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tu-todo-1",
                  name: "TodoWrite",
                  input: {
                    todos: [
                      { content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
                      { content: "Deploy", status: "pending", activeForm: "Deploy app" },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([
      { content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
      { content: "Deploy", status: "pending", activeForm: "Deploy app" },
    ]);
  });

  it("extracts todos from streamed TodoWrite (content_block_start + deltas + assistant replace)", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

    // 1. content_block_start — creates tool_call with empty args
    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu-stream-1", name: "TodoWrite" },
            },
          },
        ],
      },
    });

    // 2. content_block_delta — partial JSON
    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "event",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"todos":[{"content":"Task 1","status":"comple' },
            },
          },
        ],
      },
    });

    // Partial JSON shouldn't produce todos yet
    expect(useWsSessionStore.getState().sessions["s1"].todos).toEqual([]);

    // 3. assistant message with complete input — replace action (no toolName in mutation)
    ws.simulateMessage({
      domain: "session",
      action: "message",
      payload: {
        blocks: [
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tu-stream-1",
                  name: "TodoWrite",
                  input: {
                    todos: [{ content: "Task 1", status: "completed", activeForm: "Done" }],
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([
      { content: "Task 1", status: "completed", activeForm: "Done" },
    ]);
  });

  it("setPersistedState extracts todos from restored blocks", () => {
    useWsSessionStore.getState().connect("s1");
    const blocks = [
      { id: "b1", type: "text" as const, content: "hello" },
      {
        id: "b2",
        type: "tool_call" as const,
        content: JSON.stringify({ todos: [{ content: "Restored task", status: "pending", activeForm: "Restoring" }] }),
        toolName: "TodoWrite",
        toolArgs: JSON.stringify({ todos: [{ content: "Restored task", status: "pending", activeForm: "Restoring" }] }),
      },
      { id: "b3", type: "text" as const, content: "done" },
    ];
    useWsSessionStore.getState().setPersistedState("s1", { blocks, status: "completed" });
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([
      { content: "Restored task", status: "pending", activeForm: "Restoring" },
    ]);
  });

  it("setPersistedState extracts todos from child blocks", () => {
    useWsSessionStore.getState().connect("s1");
    const blocks = [
      {
        id: "b1",
        type: "tool_call" as const,
        content: "{}",
        toolName: "Agent",
        childBlocks: [
          {
            id: "b2",
            type: "tool_call" as const,
            content: JSON.stringify({ todos: [{ content: "Child task", status: "completed", activeForm: "Done" }] }),
            toolName: "TodoWrite",
            toolArgs: JSON.stringify({ todos: [{ content: "Child task", status: "completed", activeForm: "Done" }] }),
          },
        ],
      },
    ];
    useWsSessionStore.getState().setPersistedState("s1", { blocks, status: "completed" });
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([
      { content: "Child task", status: "completed", activeForm: "Done" },
    ]);
  });

  it("setPersistedState without TodoWrite blocks leaves todos empty", () => {
    useWsSessionStore.getState().connect("s1");
    const blocks = [{ id: "b1", type: "text" as const, content: "no todos here" }];
    useWsSessionStore.getState().setPersistedState("s1", { blocks, status: "completed" });
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([]);
  });

  it("setPersistedState does not overwrite existing streaming blocks", () => {
    useWsSessionStore.getState().connect("s1");
    // Simulate streaming blocks already present
    const store = useWsSessionStore.getState();
    store.sessions["s1"] = { ...store.sessions["s1"], blocks: [{ id: "live-1", type: "text" as never, content: "streaming" }] };

    // Now call setPersistedState with different blocks (stale DB data)
    useWsSessionStore.getState().setPersistedState("s1", {
      blocks: [{ id: "db-1", type: "text" as const, content: "stale" }],
      status: "completed",
    });
    const session = useWsSessionStore.getState().sessions["s1"];
    // Should keep the streaming blocks, not replace with stale DB blocks
    expect(session.blocks[0].id).toBe("live-1");
    expect(session.persistedLoaded).toBe(true);
  });

  it("handles concurrent sessions independently", async () => {
    const store = useWsSessionStore.getState();
    store.connect("a");
    store.connect("b");
    await tick();
    expect(MockWebSocket.instances.length).toBe(2);

    const wsA = MockWebSocket.instances[0];
    wsA.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-a" } });
    const wsB = MockWebSocket.instances[1];
    wsB.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-b" } });

    store.sendPrompt("a", "msg-a");
    store.sendPrompt("b", "msg-b");

    const sessions = useWsSessionStore.getState().sessions;
    expect(sessions["a"].blocks[0].content).toBe("msg-a");
    expect(sessions["b"].blocks[0].content).toBe("msg-b");
  });

  describe("feature.renamed", () => {
    it("sets featureTitle on the session entry", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({
        domain: "session",
        action: "feature.renamed",
        payload: { feature_id: 1, title: "New Feature Name" },
      });
      expect(useWsSessionStore.getState().sessions["s1"].featureTitle).toBe("New Feature Name");
    });

    it("ignores feature.renamed with no title", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({
        domain: "session",
        action: "feature.renamed",
        payload: { feature_id: 1 },
      });
      expect(useWsSessionStore.getState().sessions["s1"].featureTitle).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Plan approval gate flow
  // ---------------------------------------------------------------------------

  describe("plan approval gate", () => {
    async function setupWithInit() {
      const store = useWsSessionStore.getState();
      store.connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });
      return { store, ws };
    }

    function streamExitPlanMode(ws: MockWebSocket) {
      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "toolu_plan", name: "ExitPlanMode", input: { plan: "## My Plan" } },
              ],
            },
          }],
        },
      });
    }

    function sendPlanPermissionRequest(ws: MockWebSocket) {
      ws.simulateMessage({
        domain: "session",
        action: "permission.request",
        payload: {
          request_id: "req-plan-1",
          tool_name: "ExitPlanMode",
          tool_input: { plan: "## My Plan" },
          description: "Plan is ready for approval",
        },
      });
    }

    it("ExitPlanMode permission.request shows plan approval bar", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);

      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.pendingPlanApproval).toEqual({ plan: "## My Plan" });
      expect(session.pendingRequestId).toBe("req-plan-1");
      expect(session.status).toBe("paused");
    });

    it("ExitPlanMode permission.request clears exitPlanModeDetected flag", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);

      // exitPlanModeDetected should be set after streaming
      const stateBefore = useWsSessionStore.getState().sessions["s1"];
      expect(stateBefore.streamingState.exitPlanModeDetected).toBe(true);

      sendPlanPermissionRequest(ws);

      // Flag should be cleared so turn_complete doesn't re-trigger
      const stateAfter = useWsSessionStore.getState().sessions["s1"];
      expect(stateAfter.streamingState.exitPlanModeDetected).toBe(false);
    });

    it("approvePlan sends permission.respond and mode.set, switches to acceptEdits", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);

      useWsSessionStore.getState().approvePlan("s1");

      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.pendingPlanApproval).toBeNull();
      expect(session.pendingRequestId).toBe("");
      expect(session.permissionMode).toBe("acceptEdits");
      expect(session.status).toBe("running");

      // Should have sent mode.set and permission.respond
      const sent = ws.sent.map((s) => JSON.parse(s));
      const modeSet = sent.find((m: Record<string, unknown>) => m.action === "mode.set");
      expect(modeSet).toBeDefined();
      expect(modeSet.payload.mode).toBe("acceptEdits");

      const permResp = sent.find((m: Record<string, unknown>) => m.action === "permission.respond");
      expect(permResp).toBeDefined();
      expect(permResp.payload.request_id).toBe("req-plan-1");
      expect(permResp.payload.decision).toBe("allow_once");
    });

    it("approvePlan adds 'Plan approved.' user message and marks plan block approved", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);

      useWsSessionStore.getState().approvePlan("s1");

      const session = useWsSessionStore.getState().sessions["s1"];
      const userMsgs = session.blocks.filter((b) => b.type === "user_message");
      expect(userMsgs).toHaveLength(1);
      expect(userMsgs[0].content).toBe("Plan approved.");

      const planBlock = session.blocks.find((b) => b.toolName === "ExitPlanMode");
      expect(planBlock?.planApprovalStatus).toBe("approved");
    });

    it("requestPlanChanges sends permission.respond with deny and feedback", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);

      useWsSessionStore.getState().requestPlanChanges("s1", "Use a simpler approach");

      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.pendingPlanApproval).toBeNull();
      expect(session.pendingRequestId).toBe("");
      expect(session.status).toBe("running");

      const sent = ws.sent.map((s) => JSON.parse(s));
      const permResp = sent.find((m: Record<string, unknown>) => m.action === "permission.respond");
      expect(permResp).toBeDefined();
      expect(permResp.payload.decision).toBe("deny");
      expect(permResp.payload.feedback).toBe("Use a simpler approach");
    });

    it("requestPlanChanges adds feedback as user message and marks plan block rejected", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);

      useWsSessionStore.getState().requestPlanChanges("s1", "Try again differently");

      const session = useWsSessionStore.getState().sessions["s1"];
      const userMsgs = session.blocks.filter((b) => b.type === "user_message");
      expect(userMsgs).toHaveLength(1);
      expect(userMsgs[0].content).toBe("Try again differently");

      const planBlock = session.blocks.find((b) => b.toolName === "ExitPlanMode");
      expect(planBlock?.planApprovalStatus).toBe("rejected");
    });

    it("requestPlanChanges with empty feedback skips user message block", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);

      useWsSessionStore.getState().requestPlanChanges("s1", "");

      const session = useWsSessionStore.getState().sessions["s1"];
      const userMsgs = session.blocks.filter((b) => b.type === "user_message");
      expect(userMsgs).toHaveLength(0);

      const planBlock = session.blocks.find((b) => b.toolName === "ExitPlanMode");
      expect(planBlock?.planApprovalStatus).toBe("rejected");
    });

    it("turn_complete after gate-based approval does not re-trigger approval bar", async () => {
      const { ws } = await setupWithInit();
      streamExitPlanMode(ws);
      sendPlanPermissionRequest(ws);
      useWsSessionStore.getState().approvePlan("s1");

      // Simulate turn_complete after the CLI resumes
      ws.simulateMessage({ domain: "session", action: "turn_complete", payload: {} });

      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.pendingPlanApproval).toBeNull();
      expect(session.status).toBe("idle");
    });
  });

  // ---------------------------------------------------------------------------
  // EnterPlanMode detection
  // ---------------------------------------------------------------------------

  describe("EnterPlanMode detection", () => {
    it("EnterPlanMode in stream switches permissionMode to plan", async () => {
      const store = useWsSessionStore.getState();
      store.connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "tu-enter", name: "EnterPlanMode", input: {} },
              ],
            },
          }],
        },
      });

      expect(useWsSessionStore.getState().sessions["s1"].permissionMode).toBe("plan");
    });

    it("EnterPlanMode flag is reset after processing", async () => {
      const store = useWsSessionStore.getState();
      store.connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({ domain: "session", action: "initialized", payload: { session_id: "srv-1" } });

      ws.simulateMessage({
        domain: "session",
        action: "message",
        payload: {
          blocks: [{
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "tu-enter", name: "EnterPlanMode", input: {} },
              ],
            },
          }],
        },
      });

      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.permissionMode).toBe("plan");
      // Flag should have been consumed
      expect(session.streamingState.enterPlanModeDetected).toBe(false);
    });
  });

  describe("worktree events", () => {
    it("handles worktree.creating event from workflow domain", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({
        domain: "workflow",
        action: "worktree.creating",
        payload: { branch: "feature/test-abc", path: "/tmp/wt" },
      });
      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.worktreeStatus).toBe("creating");
      expect(session.worktreeBranch).toBe("feature/test-abc");
      expect(session.worktreePath).toBe("/tmp/wt");
    });

    it("handles worktree.created event", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({
        domain: "workflow",
        action: "worktree.created",
        payload: { branch: "feature/test-abc", path: "/tmp/wt" },
      });
      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.worktreeStatus).toBe("created");
    });

    it("handles worktree.setup_output appending lines", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      const ws = getWs();
      ws.simulateMessage({ domain: "workflow", action: "worktree.setup_running", payload: {} });
      ws.simulateMessage({ domain: "workflow", action: "worktree.setup_output", payload: { line: "Installing deps..." } });
      ws.simulateMessage({ domain: "workflow", action: "worktree.setup_output", payload: { line: "Done." } });
      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.worktreeStatus).toBe("setup_running");
      expect(session.worktreeSetupOutput).toEqual(["Installing deps...", "Done."]);
    });

    it("handles worktree.ready event", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      getWs().simulateMessage({ domain: "workflow", action: "worktree.ready", payload: {} });
      expect(useWsSessionStore.getState().sessions["s1"].worktreeStatus).toBe("ready");
    });

    it("handles worktree.setup_error event", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      getWs().simulateMessage({
        domain: "workflow",
        action: "worktree.setup_error",
        payload: { error: "pnpm install failed" },
      });
      const session = useWsSessionStore.getState().sessions["s1"];
      expect(session.worktreeStatus).toBe("setup_error");
      expect(session.worktreeError).toBe("pnpm install failed");
    });

    it("retryWorktreeSetup sends envelope without optimistic update", async () => {
      useWsSessionStore.getState().connect("s1");
      await tick();
      const ws = getWs();
      // Initialize session
      ws.simulateMessage({
        domain: "session",
        action: "initialized",
        payload: { session_id: "db-1" },
      });
      const store = useWsSessionStore.getState();
      store.retryWorktreeSetup("s1");
      // Should NOT optimistically set status
      expect(useWsSessionStore.getState().sessions["s1"].worktreeStatus).toBe("idle");
      // Should have sent the envelope
      const sent = ws.sent.map((s) => JSON.parse(s));
      const retryMsg = sent.find((m) => m.action === "retry_worktree_setup");
      expect(retryMsg).toBeDefined();
      expect(retryMsg.payload.feature_id).toBeNull();
    });
  });

  describe("applyMutations – toolArgs during streaming", () => {
    it("preserves toolArgs when content is partial JSON", () => {
      const validArgs = JSON.stringify({ description: "Find files", prompt: "search" });
      const existing = [
        { id: "b1", type: "tool_call" as const, content: validArgs, toolName: "Agent", toolArgs: validArgs },
      ];
      const streamState = createStreamingState();
      // Simulate a streaming delta that makes content partial JSON
      const result = applyMutations(existing, [
        { action: "replace", block: { id: "b1", type: "tool_call", content: '{"description": "Fi', toolName: "Agent" } },
      ], streamState);
      // toolArgs should still hold the previous valid value
      expect(result[0].toolArgs).toBe(validArgs);
    });

    it("updates toolArgs when content becomes valid JSON", () => {
      const existing = [
        { id: "b1", type: "tool_call" as const, content: "", toolName: "Agent", toolArgs: "" },
      ];
      const streamState = createStreamingState();
      const newArgs = JSON.stringify({ description: "Run tests" });
      const result = applyMutations(existing, [
        { action: "replace", block: { id: "b1", type: "tool_call", content: newArgs, toolName: "Agent" } },
      ], streamState);
      expect(result[0].toolArgs).toBe(newArgs);
    });

    it("preserves child block toolArgs when content is partial JSON", () => {
      const validArgs = JSON.stringify({ description: "Explore code" });
      const parent = {
        id: "p1", type: "tool_call" as const, content: "{}", toolName: "Agent",
        toolUseId: "tu1",
        childBlocks: [
          { id: "c1", type: "tool_call" as const, content: validArgs, toolName: "Read", toolArgs: validArgs },
        ],
      };
      const streamState = createStreamingState();
      streamState.toolUseIdToBlock.set("tu1", parent);
      // Update targets child block (not found in root, so falls through to child search)
      const result = applyMutations([], [
        { action: "replace", block: { id: "c1", type: "tool_call", content: '{"desc', toolName: "Read" } },
      ], streamState);
      const updatedChild = streamState.toolUseIdToBlock.get("tu1")!.childBlocks![0];
      expect(updatedChild.toolArgs).toBe(validArgs);
    });
  });
});
