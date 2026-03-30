import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsPermissionGranted = vi.fn<() => Promise<boolean>>();
const mockSendNotification = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: (...args: unknown[]) => mockIsPermissionGranted(...(args as [])),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

// Must import after mocks are set up
const { initNotificationPermission, notifyAgentDone } = await import("./notify-agent-done");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initNotificationPermission", () => {
  it("caches the permission result", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    await initNotificationPermission();
    expect(mockIsPermissionGranted).toHaveBeenCalledOnce();
  });
});

describe("notifyAgentDone", () => {
  it("does not send when permission is not granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    await initNotificationPermission();

    notifyAgentDone({ status: "completed", featureTitle: "My Feature" });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("does not send when window is focused", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    await initNotificationPermission();

    // Simulate window focus
    window.dispatchEvent(new Event("focus"));

    notifyAgentDone({ status: "completed", featureTitle: "My Feature" });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sends notification when window is blurred and permission granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    await initNotificationPermission();

    // Simulate window blur
    window.dispatchEvent(new Event("blur"));

    notifyAgentDone({ status: "completed", featureTitle: "My Feature" });
    expect(mockSendNotification).toHaveBeenCalledWith({
      title: "Agent finished",
      body: "My Feature",
    });
  });

  it("uses 'Agent error' title for error status", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);
    await initNotificationPermission();
    window.dispatchEvent(new Event("blur"));

    notifyAgentDone({ status: "error", featureTitle: "Broken Feature" });
    expect(mockSendNotification).toHaveBeenCalledWith({
      title: "Agent error",
      body: "Broken Feature",
    });
  });
});
