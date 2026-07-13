import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWsSessionStore } from "./ws-session-store";
import { invalidateWorktreeQueries } from "@/lib/worktreeQueries";

vi.mock("@/lib/worktreeQueries", () => ({
  invalidateWorktreeQueries: vi.fn(),
}));

class MockWebSocket {
  static OPEN = 1;
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

  close(): void {}

  fireEvent(event: string, data?: unknown): void {
    for (const cb of this.listeners[event] ?? []) {
      cb(data ?? {});
    }
  }

  simulateMessage(envelope: {
    domain: string;
    action: string;
    payload: unknown;
    ref?: string;
  }): void {
    this.fireEvent("message", { data: JSON.stringify({ id: "srv-1", ...envelope }) });
  }
}

function getWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

async function connectSession(): Promise<MockWebSocket> {
  useWsSessionStore.getState().connect("s1");
  await Promise.resolve();
  await Promise.resolve();
  const ws = getWs();
  ws.simulateMessage({
    domain: "session",
    action: "initialized",
    payload: { session_id: "srv-1" },
  });
  return ws;
}

function sendPermission(ws: MockWebSocket, requestId: string, command: string): void {
  ws.simulateMessage({
    domain: "session",
    action: "permission.request",
    payload: {
      request_id: requestId,
      tool_name: "Bash",
      tool_input: { command },
      description: `run ${command}`,
    },
  });
}

describe("ws-session-store permission queue", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    useWsSessionStore.setState({ sessions: {} });
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.mocked(invalidateWorktreeQueries).mockClear();
  });

  afterEach(() => {
    useWsSessionStore.getState().disconnect("s1");
    vi.restoreAllMocks();
  });

  it("shows multiple permission requests one at a time for the same session", async () => {
    const ws = await connectSession();
    sendPermission(ws, "req-1", "ls");
    sendPermission(ws, "req-2", "pwd");

    let session = useWsSessionStore.getState().sessions["s1"];
    expect(session.pendingPermission?.requestId).toBe("req-1");
    expect(session.pendingPermission?.input).toEqual({ command: "ls" });
    expect(session.pendingRequestId).toBe("req-1");

    useWsSessionStore.getState().respondToPermission("s1", "req-1", "allow_once");

    session = useWsSessionStore.getState().sessions["s1"];
    expect(session.pendingPermission?.requestId).toBe("req-1");
    expect(session.pendingPermissionQueue.map((permission) => permission.requestId)).toEqual([
      "req-2",
    ]);

    const firstResponse = JSON.parse(ws.sent.at(-1)!);
    ws.simulateMessage({
      domain: "session",
      action: "acknowledged",
      ref: firstResponse.id,
      payload: { action: "permission.respond" },
    });
    await Promise.resolve();

    session = useWsSessionStore.getState().sessions["s1"];
    expect(session.pendingPermission?.requestId).toBe("req-2");
    expect(session.pendingPermission?.input).toEqual({ command: "pwd" });
    expect(session.pendingRequestId).toBe("req-2");

    useWsSessionStore.getState().respondToPermission("s1", "req-2", "deny");

    const secondResponse = JSON.parse(ws.sent.at(-1)!);
    ws.simulateMessage({
      domain: "session",
      action: "acknowledged",
      ref: secondResponse.id,
      payload: { action: "permission.respond" },
    });
    await Promise.resolve();

    session = useWsSessionStore.getState().sessions["s1"];
    expect(session.pendingPermission).toBeNull();
    expect(session.pendingRequestId).toBe("");
  });

  it("tracks submittingPermissionRequestId between send and ack", async () => {
    const ws = await connectSession();
    sendPermission(ws, "req-1", "ls");

    let session = useWsSessionStore.getState().sessions["s1"];
    expect(session.submittingPermissionRequestId).toBeNull();

    useWsSessionStore.getState().respondToPermission("s1", "req-1", "allow_once");

    session = useWsSessionStore.getState().sessions["s1"];
    expect(session.submittingPermissionRequestId).toBe("req-1");

    const response = JSON.parse(ws.sent.at(-1)!);
    ws.simulateMessage({
      domain: "session",
      action: "acknowledged",
      ref: response.id,
      payload: { action: "permission.respond" },
    });
    await Promise.resolve();

    session = useWsSessionStore.getState().sessions["s1"];
    expect(session.submittingPermissionRequestId).toBeNull();
  });

  it("clears submittingPermissionRequestId on error so the user can retry", async () => {
    const ws = await connectSession();
    sendPermission(ws, "req-1", "ls");
    useWsSessionStore.getState().respondToPermission("s1", "req-1", "allow_once");

    let session = useWsSessionStore.getState().sessions["s1"];
    expect(session.submittingPermissionRequestId).toBe("req-1");

    const response = JSON.parse(ws.sent.at(-1)!);
    ws.simulateMessage({
      domain: "session",
      action: "error",
      ref: response.id,
      payload: { message: "backend exploded" },
    });
    await Promise.resolve();

    session = useWsSessionStore.getState().sessions["s1"];
    expect(session.submittingPermissionRequestId).toBeNull();
    // Permission stays so the user can retry once the backend recovers.
    expect(session.pendingPermission?.requestId).toBe("req-1");

    const firstPayload = response.payload as Record<string, unknown>;
    useWsSessionStore.getState().respondToPermission("s1", "req-1", "allow_once");
    const retry = JSON.parse(ws.sent.at(-1)!);
    expect(retry.payload.message_uuid).toBe(firstPayload.message_uuid);
  });

  it("drops a duplicate respondToPermission call while one is already in flight", async () => {
    const ws = await connectSession();
    sendPermission(ws, "req-1", "ls");
    useWsSessionStore.getState().respondToPermission("s1", "req-1", "allow_once");
    const sentAfterFirst = ws.sent.length;

    // Second click before the ack — should be a no-op.
    useWsSessionStore.getState().respondToPermission("s1", "req-1", "deny");
    expect(ws.sent.length).toBe(sentAfterFirst);
  });
});
