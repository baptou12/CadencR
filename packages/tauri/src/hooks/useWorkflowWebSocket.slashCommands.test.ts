/**
 * Tests for slash command support in the workflow WebSocket store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkflowStore } from "./useWorkflowWebSocket";

vi.mock("@/stores/ws-session-store", () => ({
  createStreamingState: () => ({
    activeTextIndex: null,
    activeThinkingIndex: null,
    toolCalls: new Map(),
  }),
  processSdkMessage: () => [],
  applyMutations: (blocks: unknown[]) => blocks,
}));

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
    agents: new Map(),
    workflowStatus: "idle",
    pauseReason: null,
    autonomyLevel: 1,
    selectedItemId: null,
    error: null,
    hydrated: false,
    slashCommands: [],
    slashCommandsLoading: false,
  });
});

afterEach(() => {
  globalThis.WebSocket = origWebSocket;
});

function connectStore(): MockWebSocket {
  useWorkflowStore.getState().connect(1, 1);
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.emit("open");
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("slash commands", () => {
  it("requestSlashCommands sends commands.get envelope", () => {
    const ws = connectStore();

    useWorkflowStore.getState().requestSlashCommands("/some/path");

    expect(useWorkflowStore.getState().slashCommandsLoading).toBe(true);
    const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(msg.domain).toBe("commands");
    expect(msg.action).toBe("get");
    expect(msg.payload.cwd).toBe("/some/path");
  });

  it("does not re-request when already loading", () => {
    const ws = connectStore();

    useWorkflowStore.getState().requestSlashCommands("/path");
    const sentCount = ws.sent.length;

    useWorkflowStore.getState().requestSlashCommands("/path");
    expect(ws.sent.length).toBe(sentCount);
  });

  it("does not re-request when commands already loaded", () => {
    const ws = connectStore();
    useWorkflowStore.setState({
      slashCommands: [{ name: "clear", description: "Clear" }],
    });

    useWorkflowStore.getState().requestSlashCommands("/path");
    // Only the feature.start message from connect, no commands.get
    const msgs = ws.sent.map((s) => JSON.parse(s));
    expect(msgs.every((m: { domain: string }) => m.domain !== "commands")).toBe(true);
  });

  it("handles commands.list response and populates slashCommands", () => {
    const ws = connectStore();

    // Simulate server response
    ws.emit("message", {
      data: JSON.stringify({
        domain: "commands",
        action: "list",
        payload: {
          commands: [
            { name: "clear", description: "Clear conversation" },
            { name: "compact" },
          ],
        },
      }),
    });

    const state = useWorkflowStore.getState();
    expect(state.slashCommandsLoading).toBe(false);
    expect(state.slashCommands).toEqual([
      { name: "clear", description: "Clear conversation" },
      { name: "compact", description: "" },
    ]);
  });

  it("resets slash commands on connect", () => {
    useWorkflowStore.setState({
      slashCommands: [{ name: "old", description: "stale" }],
      slashCommandsLoading: true,
    });

    connectStore();

    const state = useWorkflowStore.getState();
    expect(state.slashCommands).toEqual([]);
    expect(state.slashCommandsLoading).toBe(false);
  });
});
