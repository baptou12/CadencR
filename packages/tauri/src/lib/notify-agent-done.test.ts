import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

// Must import after mocks are set up
const { initNotificationPermission, notifyAgentDone, notifyAgentNeedsInput } =
  await import("./notify-agent-done");

const baseOpts = { featureId: 1, projectId: 2, routeType: "workflow" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initNotificationPermission", () => {
  it("caches the permission result", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    expect(mockInvoke).toHaveBeenCalledWith("plugin:notification-router|check_permission");
  });
});

describe("notifyAgentDone", () => {
  it("does not send when permission is not granted", async () => {
    mockInvoke.mockResolvedValue(false);
    await initNotificationPermission();
    mockInvoke.mockClear();

    notifyAgentDone({ status: "completed", featureTitle: "My Feature", ...baseOpts });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not send when user is on the workflow feature page", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/projects/2/features/1" },
      writable: true,
    });

    notifyAgentDone({ status: "completed", featureTitle: "My Feature", ...baseOpts });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not send when user is on the session page", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/ws-session/ws-feature-1" },
      writable: true,
    });

    notifyAgentDone({
      status: "completed",
      featureTitle: "My Feature",
      featureId: 1,
      projectId: 2,
      routeType: "session",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("sends notification when user is on a different page", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/projects/2/features/99" },
      writable: true,
    });

    notifyAgentDone({
      status: "completed",
      featureTitle: "My Feature",
      agentKind: "Execute",
      agentTitle: "Build login",
      ...baseOpts,
    });
    expect(mockInvoke).toHaveBeenCalledWith("plugin:notification-router|send_notification", {
      title: "Agent finished",
      body: "My Feature\nExecute: Build login",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });

  it("uses 'Agent error' title for error status", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentDone({
      status: "error",
      featureTitle: "Broken Feature",
      agentKind: "Execute",
      ...baseOpts,
    });
    expect(mockInvoke).toHaveBeenCalledWith("plugin:notification-router|send_notification", {
      title: "Agent error",
      body: "Broken Feature\nExecute",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });

  it("uses 'Agent needs input' title for needs_input status", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentDone({ status: "needs_input", featureTitle: "Waiting Feature", ...baseOpts });
    expect(mockInvoke).toHaveBeenCalledWith("plugin:notification-router|send_notification", {
      title: "Agent needs input",
      body: "Waiting Feature",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });

  it("shows only feature title when no agentKind provided", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentDone({ status: "completed", featureTitle: "My Feature", ...baseOpts });
    expect(mockInvoke).toHaveBeenCalledWith("plugin:notification-router|send_notification", {
      title: "Agent finished",
      body: "My Feature",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });
});

describe("notifyAgentNeedsInput", () => {
  it("sends a needs_input notification", async () => {
    mockInvoke.mockResolvedValue(true);
    await initNotificationPermission();
    mockInvoke.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentNeedsInput({ featureTitle: "My Feature", agentKind: "Plan", ...baseOpts });
    expect(mockInvoke).toHaveBeenCalledWith("plugin:notification-router|send_notification", {
      title: "Agent needs input",
      body: "My Feature\nPlan",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });
});
