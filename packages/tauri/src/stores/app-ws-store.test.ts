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
vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    getQueriesData: (...args: unknown[]) => mockGetQueriesData(...args),
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  },
}));

vi.mock("@/lib/ws-url", () => ({
  getWsUrl: () => "ws://localhost:5005/ws",
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
  send(data: string) { this.sent.push(data); }
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

function setupFeatureLookup(features: Array<{ id: number; title: string; project_id: number; type: string }>) {
  mockGetQueriesData.mockReturnValue([[["features", "list"], features]]);
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  useAppWsStore.setState({ featureTurnStates: {}, ws: null, isConnected: false });
});

describe("turn_states.snapshot", () => {
  it("sets initial turn states from snapshot", async () => {
    useAppWsStore.getState().connect();
    await vi.waitFor(() => expect(getWs()).toBeDefined());

    getWs().simulateMessage({
      domain: "app",
      action: "turn_states.snapshot",
      payload: { states: { "1": "claude", "2": "askUser", "3": "none" } },
    });

    const states = useAppWsStore.getState().featureTurnStates;
    expect(states).toEqual({ 1: "claude", 2: "askUser" });
    expect(states[3]).toBeUndefined();
  });
});

describe("turn_states.update", () => {
  it("updates a feature turn state to claude", () => {
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "claude" },
    });

    expect(useAppWsStore.getState().featureTurnStates[42]).toBe("claude");
  });

  it("removes entry on none", () => {
    useAppWsStore.setState({ featureTurnStates: { 42: "claude" } });
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 42, turn: "none" },
    });

    expect(useAppWsStore.getState().featureTurnStates[42]).toBeUndefined();
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
      payload: { feature_id: 10, turn: "askUser" },
    });

    expect(mockNotifyNeedsInput).toHaveBeenCalledWith({
      featureTitle: "My Feature",
      featureId: 10,
      projectId: 5,
      routeType: "workflow",
    });
  });

  it("fires notifyAgentDone on claude → none transition", () => {
    useAppWsStore.setState({ featureTurnStates: { 10: "claude" } });
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 10, title: "My Feature", project_id: 5, type: "default" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 10, turn: "none" },
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
    useAppWsStore.setState({ featureTurnStates: { 10: "askUser" } });
    useAppWsStore.getState().connect();
    setupFeatureLookup([{ id: 10, title: "Feature", project_id: 1, type: "default" }]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 10, turn: "none" },
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
      payload: { feature_id: 7, turn: "askUser" },
    });

    expect(mockNotifyNeedsInput).toHaveBeenCalledWith(
      expect.objectContaining({ routeType: "session" }),
    );
  });

  it("skips notification when feature not found in cache", () => {
    useAppWsStore.setState({ featureTurnStates: { 99: "claude" } });
    useAppWsStore.getState().connect();
    setupFeatureLookup([]);
    const ws = getWs();

    ws.simulateMessage({
      domain: "app",
      action: "turn_states.update",
      payload: { feature_id: 99, turn: "none" },
    });

    expect(mockNotifyDone).not.toHaveBeenCalled();
    expect(mockNotifyNeedsInput).not.toHaveBeenCalled();
  });
});

describe("editor.file_tree.changed", () => {
  it("invalidates editor caches and git stats", () => {
    useAppWsStore.getState().connect();
    const ws = getWs();

    ws.simulateMessage({
      domain: "editor",
      action: "file_tree.changed",
      payload: { project_path: "/project" },
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["editor", "tree"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["editor", "search"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["git", "stats"] });
  });
});
