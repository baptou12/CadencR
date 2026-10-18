// @vitest-environment happy-dom
/**
 * Delivery of prompts sent before `session.initialized` (issue #251): the
 * composer awaits `deliverPrompt`, so it must settle exactly when the queued
 * prompt reaches the wire, and reject when it never will.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWsSessionStore } from "./ws-session-store";

// --- Mock WebSocket (same shape as ws-session-store.test.ts) ---

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
    Promise.resolve().then(() => this.fireEvent("open"));
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

  simulateMessage(envelope: { domain: string; action: string; ref?: string; payload: unknown }) {
    const raw = JSON.stringify({ id: "srv-1", ...envelope });
    this.fireEvent("message", { data: raw });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

const activeTimerIds = new Set<ReturnType<typeof setTimeout>>();

function tick(): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(() => {
      activeTimerIds.delete(id);
      resolve();
    }, 10);
    activeTimerIds.add(id);
  });
}

function getWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

function sentActions(ws: MockWebSocket): string[] {
  return ws.sent.map((raw) => {
    const env = JSON.parse(raw) as { domain: string; action: string };
    return `${env.domain}.${env.action}`;
  });
}

beforeEach(() => {
  MockWebSocket.reset();
  useWsSessionStore.setState({ sessions: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  const store = useWsSessionStore.getState();
  for (const sessionId of Object.keys(store.sessions)) {
    store.disconnect(sessionId);
  }
  for (const id of activeTimerIds) clearTimeout(id);
  activeTimerIds.clear();
  vi.restoreAllMocks();
});

type Outcome = "pending" | "delivered" | Error;

function track(promise: Promise<void>): { outcome: Outcome } {
  const state: { outcome: Outcome } = { outcome: "pending" };
  promise.then(
    () => (state.outcome = "delivered"),
    (error: Error) => (state.outcome = error),
  );
  return state;
}

async function connectAndInit(sessionId = "s1"): Promise<{ ws: MockWebSocket; initId: string }> {
  const store = useWsSessionStore.getState();
  store.connect(sessionId);
  await tick();
  store.initSession(sessionId, { cwd: "/repo", featureId: 7 });
  const ws = getWs();
  const init = JSON.parse(ws.sent.at(-1) ?? "{}") as { id: string; action: string };
  expect(init.action).toBe("init");
  return { ws, initId: init.id };
}

describe("ws-session queued prompt delivery", () => {
  it("settles a queued prompt only once initialization flushes it", async () => {
    const { ws, initId } = await connectAndInit();
    expect(useWsSessionStore.getState().sessions.s1.initRequestId).toBe(initId);

    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));
    await tick();
    expect(delivery.outcome).toBe("pending");
    expect(sentActions(ws)).not.toContain("session.prompt.send");

    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      ref: initId,
      payload: { session_id: "srv-1" },
    });
    await tick();

    expect(delivery.outcome).toBe("delivered");
    expect(sentActions(ws)).toContain("session.prompt.send");
    const session = useWsSessionStore.getState().sessions.s1;
    expect(session.queuedPrompts).toHaveLength(0);
    expect(session.initRequestId).toBeNull();
  });

  it("settles immediately for an initialized session", async () => {
    const { ws, initId } = await connectAndInit();
    ws.simulateMessage({
      domain: "session",
      action: "initialized",
      ref: initId,
      payload: { session_id: "srv-1" },
    });

    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));
    await tick();

    expect(delivery.outcome).toBe("delivered");
    expect(sentActions(ws)).toContain("session.prompt.send");
  });

  it("rejects and drops the queue when the backend refuses session.init", async () => {
    const { ws, initId } = await connectAndInit();
    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));

    ws.simulateMessage({
      domain: "session",
      action: "error",
      ref: initId,
      payload: { code: "DB_ERROR", message: "Failed to create/find session in database" },
    });
    await tick();

    expect(delivery.outcome).toBeInstanceOf(Error);
    expect((delivery.outcome as Error).message).toBe(
      "The session could not start: Failed to create/find session in database",
    );
    const session = useWsSessionStore.getState().sessions.s1;
    expect(session.queuedPrompts).toHaveLength(0);
    expect(session.initRequestId).toBeNull();
  });

  it("ignores session errors that answer another request", async () => {
    const { ws } = await connectAndInit();
    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));

    ws.simulateMessage({
      domain: "session",
      action: "error",
      ref: "some-other-request",
      payload: { code: "INVALID", message: "nope" },
    });
    await tick();

    expect(delivery.outcome).toBe("pending");
    expect(useWsSessionStore.getState().sessions.s1.queuedPrompts).toHaveLength(1);
  });

  it("keeps the prompt queued but forgets the lost init when the socket drops", async () => {
    const { ws } = await connectAndInit();
    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));

    ws.readyState = MockWebSocket.CLOSED;
    ws.fireEvent("close", { code: 1006 });
    await tick();

    expect(delivery.outcome).toBe("pending");
    const session = useWsSessionStore.getState().sessions.s1;
    expect(session.queuedPrompts).toHaveLength(1);
    expect(session.initRequestId).toBeNull();
  });

  it("rejects pending deliveries when the session is torn down", async () => {
    await connectAndInit();
    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));

    useWsSessionStore.getState().disconnect("s1");
    await tick();

    expect(delivery.outcome).toBeInstanceOf(Error);
    expect((delivery.outcome as Error).message).toBe(
      "The session closed before the message was sent.",
    );
  });
  it("rejects pending deliveries when the backend deletes the session", async () => {
    const { ws } = await connectAndInit();
    const delivery = track(useWsSessionStore.getState().deliverPrompt("s1", "hello"));

    ws.simulateMessage({ domain: "session", action: "deleted", payload: {} });
    await tick();

    expect(delivery.outcome).toBeInstanceOf(Error);
    expect(useWsSessionStore.getState().sessions.s1).toBeUndefined();
  });

  it("rejects right away when the session entry does not exist", async () => {
    const delivery = track(useWsSessionStore.getState().deliverPrompt("missing", "hello"));
    await tick();

    expect(delivery.outcome).toBeInstanceOf(Error);
    expect(useWsSessionStore.getState().sessions.missing).toBeUndefined();
  });

  it("keeps an init parked in the outbound queue in flight across a drop", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    const ws = getWs();
    ws.readyState = MockWebSocket.CLOSED;
    store.initSession("s1", { cwd: "/repo", featureId: 7 });
    const { initRequestId, outboundQueue } = useWsSessionStore.getState().sessions.s1;
    expect(outboundQueue.map((envelope) => envelope.id)).toEqual([initRequestId]);

    ws.fireEvent("close", { code: 1006 });

    // The parked init is replayed on reconnect, so no second init may start.
    expect(useWsSessionStore.getState().sessions.s1.initRequestId).toBe(initRequestId);
  });
});
