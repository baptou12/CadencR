import { describe, it, expect, vi, beforeEach } from "vitest";
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
