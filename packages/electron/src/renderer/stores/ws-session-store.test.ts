import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_MODEL } from "../../shared/models";
import { useWsSessionStore } from "./ws-session-store";

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
  vi.stubGlobal("window", {
    ...globalThis.window,
    api: { rustBackendUrl: "http://localhost:5005" },
  });
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
    useWsSessionStore.getState().setPersistedState("s1", blocks, "completed");
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
    useWsSessionStore.getState().setPersistedState("s1", blocks, "completed");
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
    useWsSessionStore.getState().setPersistedState("s1", blocks, "completed");
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([
      { content: "Child task", status: "completed", activeForm: "Done" },
    ]);
  });

  it("setPersistedState without TodoWrite blocks leaves todos empty", () => {
    useWsSessionStore.getState().connect("s1");
    const blocks = [{ id: "b1", type: "text" as const, content: "no todos here" }];
    useWsSessionStore.getState().setPersistedState("s1", blocks, "completed");
    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.todos).toEqual([]);
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
});
