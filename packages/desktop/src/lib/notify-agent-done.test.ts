import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";
import type { CadencrDesktopBridge } from "@/lib/desktop-bridge";
import {
  initNotificationPermission,
  notifyAgentDone,
  notifyAgentNeedsInput,
} from "./notify-agent-done";

const mockNotifyPermission = vi.fn();
const mockNotify = vi.fn();

function bridge(): CadencrDesktopBridge {
  return {
    isElectron: true,
    runtimeConfig: vi.fn(),
    readFileBase64: vi.fn(),
    onFileDrop: vi.fn(() => () => undefined),
    revealInFinder: vi.fn(),
    openExternal: vi.fn(),
    pickDirectory: vi.fn(),
    notifyPermission: mockNotifyPermission,
    notify: mockNotify,
    onNotificationClicked: vi.fn(() => () => undefined),
    onCloseRequested: vi.fn(() => () => undefined),
    confirmClose: vi.fn(),
    requestQuit: vi.fn(),
    setZoom: vi.fn(),
    currentTheme: vi.fn(),
    onThemeChange: vi.fn(() => () => undefined),
  };
}

const baseOpts = { featureId: 1, projectId: 2, routeType: "workflow" as const };

beforeEach(() => {
  vi.clearAllMocks();
  setDesktopBridgeOverrideForTests(bridge());
});

afterEach(() => clearDesktopBridgeOverrideForTests());

describe("initNotificationPermission", () => {
  it("caches the permission result", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    await initNotificationPermission();
    expect(mockNotifyPermission).toHaveBeenCalled();
  });
});

describe("notifyAgentDone", () => {
  it("does not send when permission is not granted", async () => {
    mockNotifyPermission.mockResolvedValue(false);
    await initNotificationPermission();
    mockNotify.mockClear();

    notifyAgentDone({ status: "completed", featureTitle: "My Feature", ...baseOpts });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not send when user is on the workflow feature page", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/projects/2/features/1" },
      writable: true,
    });

    notifyAgentDone({ status: "completed", featureTitle: "My Feature", ...baseOpts });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not send when user is on the session page", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

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
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("sends notification when user is on a different page", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

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
    expect(mockNotify).toHaveBeenCalledWith({
      title: "Agent finished",
      body: "My Feature\nExecute: Build login",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });

  it("uses 'Agent error' title for error status", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

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
    expect(mockNotify).toHaveBeenCalledWith({
      title: "Agent error",
      body: "Broken Feature\nExecute",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });

  it("uses 'Agent needs input' title for needs_input status", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentDone({ status: "needs_input", featureTitle: "Waiting Feature", ...baseOpts });
    expect(mockNotify).toHaveBeenCalledWith({
      title: "Agent needs input",
      body: "Waiting Feature",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });

  it("shows only feature title when no agentKind provided", async () => {
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentDone({ status: "completed", featureTitle: "My Feature", ...baseOpts });
    expect(mockNotify).toHaveBeenCalledWith({
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
    mockNotifyPermission.mockResolvedValue(true);
    mockNotify.mockResolvedValue(undefined);
    await initNotificationPermission();
    mockNotify.mockClear();

    Object.defineProperty(window, "location", {
      value: { pathname: "/other" },
      writable: true,
    });

    notifyAgentNeedsInput({ featureTitle: "My Feature", agentKind: "Plan", ...baseOpts });
    expect(mockNotify).toHaveBeenCalledWith({
      title: "Agent needs input",
      body: "My Feature\nPlan",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
  });
});
