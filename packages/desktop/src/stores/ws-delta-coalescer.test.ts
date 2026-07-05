import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWsSessionStore } from "./ws-session-store";
import { setDeltaFlushScheduler } from "./ws-delta-scheduler";

// --- Minimal mock WebSocket (mirrors ws-session-store.test.ts) ---

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
    for (const cb of this.listeners[event] ?? []) cb(data ?? {});
  }
  simulateMessage(envelope: { domain: string; action: string; ref?: string; payload: unknown }) {
    this.fireEvent("message", { data: JSON.stringify({ id: "srv-1", ...envelope }) });
  }
  static reset() {
    MockWebSocket.instances = [];
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function textDelta(text: string) {
  return {
    domain: "session",
    action: "message",
    payload: { blocks: [{ type: "assistant", message: { content: [{ type: "text", text }] } }] },
  };
}

async function connected(): Promise<MockWebSocket> {
  useWsSessionStore.getState().connect("s1");
  await tick();
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.simulateMessage({
    domain: "session",
    action: "initialized",
    payload: { session_id: "srv-1" },
  });
  return ws;
}

let manualFlush: (() => void) | null;

beforeEach(() => {
  MockWebSocket.reset();
  useWsSessionStore.setState({ sessions: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  // Manual scheduler: capture the pending flush so a burst stays buffered until
  // the test fires it (overrides test-setup's synchronous default).
  manualFlush = null;
  setDeltaFlushScheduler((flush) => {
    manualFlush = flush;
  });
});

afterEach(() => {
  const store = useWsSessionStore.getState();
  for (const id of Object.keys(store.sessions)) store.disconnect(id);
  setDeltaFlushScheduler(null);
  vi.unstubAllGlobals();
});

describe("stream-delta coalescing", () => {
  it("a burst of N deltas produces exactly one store commit", async () => {
    const ws = await connected();

    let commits = 0;
    const unsub = useWsSessionStore.subscribe(() => {
      commits += 1;
    });

    for (let i = 0; i < 6; i++) ws.simulateMessage(textDelta(`chunk-${i} `));
    // Buffered: nothing applied yet.
    expect(commits).toBe(0);
    expect(useWsSessionStore.getState().sessions["s1"].blocks).toHaveLength(0);

    expect(manualFlush).not.toBeNull();
    manualFlush?.();

    // One commit for the whole burst; every delta applied.
    expect(commits).toBe(1);
    const blocks = useWsSessionStore.getState().sessions["s1"].blocks;
    expect(blocks).toHaveLength(6);
    expect(blocks.map((b) => b.content).join("")).toBe(
      "chunk-0 chunk-1 chunk-2 chunk-3 chunk-4 chunk-5 ",
    );
    unsub();
  });

  it("flushes pending deltas before a non-delta envelope, preserving order", async () => {
    const ws = await connected();

    ws.simulateMessage(textDelta("streamed text"));
    // Still buffered — the manual flush has not fired.
    expect(useWsSessionStore.getState().sessions["s1"].blocks).toHaveLength(0);

    // A non-delta envelope (error) must flush the buffered delta first, so the
    // error block lands after the streamed text rather than before it.
    ws.simulateMessage({
      domain: "session",
      action: "error",
      payload: { code: "DB_ERROR", message: "boom" },
    });

    const blocks = useWsSessionStore.getState().sessions["s1"].blocks;
    expect(blocks.map((b) => b.type)).toEqual(["text", "error"]);
    expect(blocks[0].content).toBe("streamed text");
    expect(blocks[1].content).toBe("boom");
  });

  it("does not delay a permission gate behind a pending delta buffer", async () => {
    const ws = await connected();

    ws.simulateMessage(textDelta("thinking..."));
    // The permission request must be visible immediately — it is not held for
    // the animation-frame flush that never fires in this test.
    ws.simulateMessage({
      domain: "session",
      action: "permission.request",
      payload: { request_id: "perm-1", tool_name: "Bash", tool_input: { command: "ls" } },
    });

    const session = useWsSessionStore.getState().sessions["s1"];
    expect(session.pendingPermission?.requestId).toBe("perm-1");
    // The buffered delta was flushed ahead of the gate, not dropped.
    expect(session.blocks.map((b) => b.content)).toContain("thinking...");
  });

  it("detects a seq gap across a coalesced batch (per-envelope seq tracking)", async () => {
    const ws = await connected();
    const state = useWsSessionStore.getState().sessions["s1"].streamingState;

    // seq 1, then 3 (2 dropped) inside the same buffered batch.
    ws.simulateMessage({ ...textDelta("a"), payload: { ...textDelta("a").payload, seq: 1 } });
    ws.simulateMessage({ ...textDelta("b"), payload: { ...textDelta("b").payload, seq: 3 } });
    manualFlush?.();

    expect(state.lastMessageSeq).toBe(3);
    // The gap between 1 and 3 must arm the post-turn tail repair.
    expect(state.tailRepairNeeded).toBe(true);
  });
});
