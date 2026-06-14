import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWsSessionStore } from "./ws-session-store";

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    Promise.resolve().then(() => this.fireEvent("open"));
  }

  addEventListener(event: string, cb: (...args: unknown[]) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener(event: string, cb: (...args: unknown[]) => void): void {
    this.listeners[event] = (this.listeners[event] ?? []).filter((listener) => listener !== cb);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  fireEvent(event: string, data?: unknown): void {
    for (const cb of this.listeners[event] ?? []) {
      cb(data ?? {});
    }
  }

  simulateMessage(envelope: { domain: string; action: string; payload: unknown }): void {
    this.fireEvent("message", { data: JSON.stringify({ id: "srv-1", ...envelope }) });
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function connectInitializedReceiptSession(): Promise<MockWebSocket> {
  const store = useWsSessionStore.getState();
  store.connect("s1");
  await tick();
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("missing websocket");
  ws.simulateMessage({
    domain: "session",
    action: "initialized",
    payload: {
      session_id: "srv-1",
      provider: "opencode",
      supports_prompt_receipts: true,
    },
  });
  ws.simulateMessage({
    domain: "session",
    action: "message",
    payload: {
      blocks: [{ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }],
    },
  });
  return ws;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  useWsSessionStore.setState({ sessions: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("window", { ...globalThis.window });
});

afterEach(() => {
  for (const sessionId of Object.keys(useWsSessionStore.getState().sessions)) {
    useWsSessionStore.getState().disconnect(sessionId);
  }
  vi.unstubAllGlobals();
});

describe("interrupt pending steering prompts", () => {
  it("keeps a pending steering prompt after the interrupted turn completes", async () => {
    const ws = await connectInitializedReceiptSession();
    const store = useWsSessionStore.getState();

    store.sendPrompt("s1", "steer now");
    const originalPrompt = JSON.parse(ws.sent.at(-1) ?? "{}");
    ws.sent = [];

    store.interrupt("s1");

    const sent = ws.sent.map((raw) => JSON.parse(raw));
    expect(sent.map((envelope) => envelope.action)).toEqual(["interrupt"]);

    ws.simulateMessage({
      domain: "session",
      action: "ended",
      payload: { reason: "turn_complete" },
    });

    const afterEnded = ws.sent.map((raw) => JSON.parse(raw));
    expect(afterEnded.map((envelope) => envelope.action)).toEqual(["interrupt"]);
    expect(
      useWsSessionStore
        .getState()
        .sessions.s1.blocks.find(
          (block) => block.clientMessageId === originalPrompt.payload.client_message_id,
        )?.promptDeliveryState,
    ).toBe("pending_agent");
  });

  it("does not replay pending steering prompts when an interrupted turn ends", async () => {
    const ws = await connectInitializedReceiptSession();
    const store = useWsSessionStore.getState();

    store.sendPrompt("s1", "first");
    const first = JSON.parse(ws.sent.at(-1) ?? "{}");
    store.sendPrompt("s1", "second");
    const second = JSON.parse(ws.sent.at(-1) ?? "{}");
    ws.simulateMessage({
      domain: "session",
      action: "prompt_received",
      payload: { client_message_id: first.payload.client_message_id },
    });
    ws.sent = [];

    store.interrupt("s1");

    const sent = ws.sent.map((raw) => JSON.parse(raw));
    expect(sent.map((envelope) => envelope.action)).toEqual(["interrupt"]);

    ws.simulateMessage({
      domain: "session",
      action: "ended",
      payload: { reason: "turn_complete" },
    });

    const afterEnded = ws.sent.map((raw) => JSON.parse(raw));
    expect(afterEnded.map((envelope) => envelope.action)).toEqual(["interrupt"]);
    expect(
      useWsSessionStore
        .getState()
        .sessions.s1.blocks.find(
          (block) => block.clientMessageId === second.payload.client_message_id,
        )?.promptDeliveryState,
    ).toBe("pending_agent");
  });
});
