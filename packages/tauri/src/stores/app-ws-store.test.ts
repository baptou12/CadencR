import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockNotifyDone = vi.fn();
const mockNotifyNeedsInput = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("@/lib/notify-agent-done", () => ({
  notifyAgentDone: (...args: unknown[]) => mockNotifyDone(...args),
  notifyAgentNeedsInput: (...args: unknown[]) => mockNotifyNeedsInput(...args),
}));

const mockGetQueriesData = vi.fn();
vi.mock("@/lib/queryClient", () => {
  const client = {
    getQueriesData: (...args: unknown[]) => mockGetQueriesData(...args),
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  };
  return {
    queryClient: client,
    // Mirror the real helper so production code routed through the mocked
    // module still hits `mockInvalidateQueries`. Keeping the implementation
    // local avoids the vi.mock async-factory dance for one tiny function.
    invalidateByUrlPrefix: (_client: unknown, urlPrefix: string | readonly string[]) => {
      const prefixes = typeof urlPrefix === "string" ? [urlPrefix] : urlPrefix;
      return client.invalidateQueries({
        predicate: (query: { queryKey: readonly unknown[] }) => {
          const head = query.queryKey[0];
          if (typeof head !== "string") return false;
          return prefixes.some((p) => head.startsWith(p));
        },
      });
    },
  };
});

vi.mock("@/lib/ws-url", () => ({
  getWsUrl: () => "ws://localhost:5005/ws",
  getTerminalWsUrl: () => "ws://localhost:5005/api/terminal/ws",
  getWsProtocols: () => [],
}));

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
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
  close() {}

  fireEvent(event: string, data?: unknown) {
    for (const cb of this.listeners[event] ?? []) cb(data);
  }

  simulateMessage(envelope: { domain: string; action: string; payload: unknown }) {
    const msg = JSON.stringify({ id: "test", ...envelope });
    this.fireEvent("message", { data: msg });
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

const { useAppWsStore } = await import("./app-ws-store");

// --- Helpers ---

function getWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
}

function setupFeatureLookup(
  features: Array<{ id: number; title: string; project_id: number; type: string }>,
) {
  mockGetQueriesData.mockReturnValue([[["features", "list"], features]]);
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  useAppWsStore.setState({
    featureTurnStates: {},
    featureTurnStateSeqs: {},
    ws: null,
    isConnected: false,
  });
});

describe("turn_states.snapshot", () => {
  it("sets initial turn states from snapshot", async () => {
    setupFeatureLookup([]);
    useAppWsStore.getState().connect();
    await vi.waitFor(() => expect(getWs()).toBeDefined());

    getWs().simulateMessage({
      domain: "app",
      action: "turn_states.snapshot",
      payload: {
        seq: 5,
        states: {
          "1": { turn: "agent" },
          "2": { turn: "askUser", kind: "question" },
          "3": { turn: "none" },
        },
      },
    });

    const states = useAppWsStore.getState().featureTurnStates;
    expect(states[1]).toEqual({ turn: "agent", kind: null });
    expect(states[2]).toEqual({ turn: "askUser", kind: "question" });
    expect(states[3]).toBeUndefined();
  });

  it("applies an 'agent' update on turn 2 after a tombstoned turn 1", () => {
    // Turn 1 tombstone at seq 5 (agent completed, entry deleted but seq kept).
    useAppWsStore.setState({
      featureTurnStates: {},
      featureTurnStateSeqs: { 42: 5 },
    });
    setupFeatureLookup([]);
    useAppWsStore.getState().connect();
    const ws = getWs();

    // Turn 2 starts: backend broadcasts "agent" at seq 6.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "agent", seq: 6 },
    });

    expect(useAppWsStore.getState().featureTurnStates[42]).toEqual({
      turn: "agent",
      kind: null,
    });
    expect(useAppWsStore.getState().featureTurnStateSeqs[42]).toBe(6);
  });

  it("preserves tombstone seq so a later stale update cannot resurrect it", () => {
    // Feature 42 reached `none` live at seq=10 (tombstoned but seq retained).
    useAppWsStore.setState({
      featureTurnStates: {},
      featureTurnStateSeqs: { 42: 10 },
    });
    setupFeatureLookup([]);
    useAppWsStore.getState().connect();
    const ws = getWs();

    // Older snapshot (seq=5) that omits feature 42 arrives. The store used to
    // drop the tombstone seq here because there was no live *entry* to
    // preserve — letting a stale update get reapplied.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.snapshot",
      payload: { seq: 5, states: {} },
    });
    expect(useAppWsStore.getState().featureTurnStateSeqs[42]).toBe(10);

    // Stale `askUser` update at seq=7 (< 10) must be rejected.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "askUser", seq: 7 },
    });
    expect(useAppWsStore.getState().featureTurnStates[42]).toBeUndefined();
    expect(useAppWsStore.getState().featureTurnStateSeqs[42]).toBe(10);
  });

  it("resets seqs on every fresh WS connection (backend counter is process-local)", async () => {
    // Simulate post-backend-restart state: the previous process broadcast
    // seq=100 before crashing, the client still remembers it. The new backend
    // process starts over at seq=1, which would be rejected as "older"
    // without the reset-on-open fix.
    useAppWsStore.setState({
      featureTurnStates: { 42: { turn: "askUser", kind: "question" } },
      featureTurnStateSeqs: { 42: 100 },
    });
    setupFeatureLookup([]);
    useAppWsStore.getState().connect();
    const ws = getWs();

    // Wait for the open handler to fire — it resets seqs + sends subscribe.
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    // `featureTurnStates` is preserved across reconnect (sidebar icons don't
    // blink). The stale entry self-corrects via the snapshot or a later
    // update.
    expect(useAppWsStore.getState().featureTurnStateSeqs).toEqual({});

    // A low-seq update from the fresh backend must be accepted.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "agent", seq: 1 },
    });
    expect(useAppWsStore.getState().featureTurnStates[42]).toEqual({
      turn: "agent",
      kind: null,
    });
    expect(useAppWsStore.getState().featureTurnStateSeqs[42]).toBe(1);
  });

  it("preserves live entries with newer seq than the snapshot", () => {
    // Feature 10 already got an update at seq=99 live.
    useAppWsStore.setState({
      featureTurnStates: { 10: { turn: "askUser", kind: "permission" } },
      featureTurnStateSeqs: { 10: 99 },
    });
    useAppWsStore.getState().connect();
    const ws = getWs();

    // Stale snapshot says feature 10 is "agent" at seq=5.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.snapshot",
      payload: { seq: 5, states: { "10": { turn: "agent" } } },
    });

    // Live state must win.
    expect(useAppWsStore.getState().featureTurnStates[10]).toEqual({
      turn: "askUser",
      kind: "permission",
    });
  });
});

describe("turn_states.update", () => {
  it("updates a feature turn state to agent", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "agent", seq: 1 },
    });

    expect(useAppWsStore.getState().featureTurnStates[42]).toEqual({
      turn: "agent",
      kind: null,
    });
    expect(useAppWsStore.getState().featureTurnStateSeqs[42]).toBe(1);
  });

  it("removes entry on none", () => {
    useAppWsStore.setState({
      featureTurnStates: { 42: { turn: "agent", kind: null } },
      featureTurnStateSeqs: { 42: 1 },
    });
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "none", seq: 2 },
    });

    expect(useAppWsStore.getState().featureTurnStates[42]).toBeUndefined();
  });

  it("ignores a stale update whose seq is not newer than the last applied", () => {
    useAppWsStore.setState({
      featureTurnStates: { 42: { turn: "agent", kind: null } },
      featureTurnStateSeqs: { 42: 10 },
    });
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    // Older event arriving out-of-order.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "askUser", seq: 5 },
    });

    expect(useAppWsStore.getState().featureTurnStates[42]).toEqual({
      turn: "agent",
      kind: null,
    });
    expect(useAppWsStore.getState().featureTurnStateSeqs[42]).toBe(10);
  });

  it("preserves the pending kind alongside askUser", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 7, turn: "askUser", seq: 1, kind: "plan-approval" },
    });

    expect(useAppWsStore.getState().featureTurnStates[7]).toEqual({
      turn: "askUser",
      kind: "plan-approval",
    });
  });

  it("keeps the featureTurnStates reference stable when only seq advances", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 9, turn: "agent", seq: 1 },
    });
    const firstStates = useAppWsStore.getState().featureTurnStates;

    // Same turn + kind, but a fresher seq — selectors that read
    // featureTurnStates should not re-render.
    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 9, turn: "agent", seq: 2 },
    });

    expect(useAppWsStore.getState().featureTurnStates).toBe(firstStates);
    expect(useAppWsStore.getState().featureTurnStateSeqs[9]).toBe(2);
  });
});

describe("notifications from turn state", () => {
  it("fires notifyAgentNeedsInput on askUser transition", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 10, title: "My Feature", project_id: 5, type: "default" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 10, turn: "askUser", seq: 1 },
    });

    expect(mockNotifyNeedsInput).toHaveBeenCalledWith({
      featureTitle: "My Feature",
      featureId: 10,
      projectId: 5,
      routeType: "workflow",
    });
  });

  it("fires notifyAgentDone on agent → none transition", () => {
    useAppWsStore.setState({
      featureTurnStates: { 10: { turn: "agent", kind: null } },
      featureTurnStateSeqs: { 10: 1 },
    });
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 10, title: "My Feature", project_id: 5, type: "default" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 10, turn: "none", seq: 2 },
    });

    expect(mockNotifyDone).toHaveBeenCalledWith({
      featureTitle: "My Feature",
      featureId: 10,
      projectId: 5,
      routeType: "workflow",
      status: "completed",
    });
  });

  it("does NOT fire notifyAgentDone on askUser → none (not a completion)", () => {
    useAppWsStore.setState({
      featureTurnStates: { 10: { turn: "askUser", kind: null } },
      featureTurnStateSeqs: { 10: 1 },
    });
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 10, title: "Feature", project_id: 1, type: "default" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 10, turn: "none", seq: 2 },
    });

    expect(mockNotifyDone).not.toHaveBeenCalled();
  });

  it("uses session route type for ws-session features", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 7, title: "Session", project_id: 3, type: "ws-session" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 7, turn: "askUser", seq: 1 },
    });

    expect(mockNotifyNeedsInput).toHaveBeenCalledWith(
      expect.objectContaining({ routeType: "session" }),
    );
  });

  it("skips notification when feature not found in cache", () => {
    useAppWsStore.setState({
      featureTurnStates: { 99: { turn: "agent", kind: null } },
      featureTurnStateSeqs: { 99: 1 },
    });
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 99, turn: "none", seq: 2 },
    });

    expect(mockNotifyDone).not.toHaveBeenCalled();
    expect(mockNotifyNeedsInput).not.toHaveBeenCalled();
  });

  it("fires notifyAgentNeedsInput from snapshot when askUser appears fresh", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 11, title: "Reconnected", project_id: 2, type: "default" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.snapshot",
      payload: {
        seq: 3,
        states: { "11": { turn: "askUser", kind: "question" } },
      },
    });

    expect(mockNotifyNeedsInput).toHaveBeenCalledWith(
      expect.objectContaining({ featureId: 11, routeType: "workflow" }),
    );
  });
});

describe("editor.file_tree.changed", () => {
  it("invalidates editor + git-stats caches in a single predicate walk", () => {
    useAppWsStore.getState().connect();
    const ws = getWs();

    ws.simulateMessage({
      domain: "editor",
      action: "file_tree.changed",
      payload: { project_path: "/project" },
    });

    // Single predicate-based call covering all three URL prefixes — replaces
    // the prior three separate cache walks.
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    const arg = mockInvalidateQueries.mock.calls[0]?.[0] as {
      predicate?: (q: { queryKey: readonly unknown[] }) => boolean;
    };
    expect(typeof arg.predicate).toBe("function");
    expect(arg.predicate?.({ queryKey: ["/api/editor/tree"] })).toBe(true);
    expect(arg.predicate?.({ queryKey: ["/api/editor/search", { project_id: 1 }] })).toBe(true);
    expect(arg.predicate?.({ queryKey: ["/api/git/stats"] })).toBe(true);
    expect(arg.predicate?.({ queryKey: ["/api/features"] })).toBe(false);
  });
});

describe("reconnect preserves featureTurnStates", () => {
  it("keeps existing entries and only resets seq counters on ws open", async () => {
    // Seed pre-existing state as if a previous connection populated it.
    useAppWsStore.setState({
      featureTurnStates: { 1: { turn: "agent", kind: null } },
      featureTurnStateSeqs: { 1: 42 },
    });

    setupFeatureLookup([]);
    useAppWsStore.getState().connect();
    await vi.waitFor(() => expect(getWs()).toBeDefined());
    // `open` fires synchronously via the MockWebSocket constructor's setTimeout(0).
    await vi.waitFor(() => expect(useAppWsStore.getState().isConnected).toBe(true));

    const state = useAppWsStore.getState();
    // `featureTurnStates` is preserved — sidebar icons don't blink during the
    // window before the snapshot lands.
    expect(state.featureTurnStates[1]).toEqual({ turn: "agent", kind: null });
    // `featureTurnStateSeqs` is reset so stale backend seqs don't block fresh updates.
    expect(state.featureTurnStateSeqs).toEqual({});
  });

  it("drops a preserved entry once the snapshot tombstones it", async () => {
    useAppWsStore.setState({
      featureTurnStates: { 1: { turn: "agent", kind: null } },
      featureTurnStateSeqs: { 1: 42 },
    });

    setupFeatureLookup([]);
    useAppWsStore.getState().connect();
    await vi.waitFor(() => expect(getWs()).toBeDefined());
    await vi.waitFor(() => expect(useAppWsStore.getState().isConnected).toBe(true));

    // Snapshot without feature 1 → feature 1 is tombstoned and removed.
    getWs().simulateMessage({
      domain: "app",
      action: "turn_states.snapshot",
      payload: { seq: 100, states: {} },
    });

    const state = useAppWsStore.getState();
    expect(state.featureTurnStates[1]).toBeUndefined();
  });
});
