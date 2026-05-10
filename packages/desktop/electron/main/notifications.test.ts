import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const electronState = vi.hoisted(() => ({
  isSupported: true,
  showCalls: 0,
  failedHandlers: [] as Array<(event: unknown, error: string) => void>,
  clickHandlers: [] as Array<() => void>,
}));

vi.mock("electron", () => {
  class FakeNotification {
    static isSupported(): boolean {
      return electronState.isSupported;
    }
    constructor(public opts: { title: string; body: string }) {}
    on(event: "failed" | "click", cb: (...args: never[]) => void): this {
      if (event === "failed") {
        electronState.failedHandlers.push(cb as (event: unknown, error: string) => void);
      } else {
        electronState.clickHandlers.push(cb as () => void);
      }
      return this;
    }
    show(): void {
      electronState.showCalls += 1;
    }
  }
  return { Notification: FakeNotification };
});

import { sendNotification, sendTestNotification } from "./notifications";

interface FakeWebContents {
  destroyed: boolean;
  send: ReturnType<typeof vi.fn>;
  isDestroyed(): boolean;
}
interface FakeBrowserWindow {
  destroyed: boolean;
  webContents: FakeWebContents;
  isDestroyed(): boolean;
}

function fakeWindow(
  opts: { winDestroyed?: boolean; wcDestroyed?: boolean } = {},
): FakeBrowserWindow {
  const win: FakeBrowserWindow = {
    destroyed: opts.winDestroyed ?? false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: {
      destroyed: opts.wcDestroyed ?? false,
      send: vi.fn(),
      isDestroyed() {
        return this.destroyed;
      },
    },
  };
  return win;
}

const baseOpts = {
  title: "Done",
  body: "Agent finished",
  featureId: 1,
  projectId: 2,
  routeType: "workflow" as const,
};

beforeEach(() => {
  electronState.isSupported = true;
  electronState.showCalls = 0;
  electronState.failedHandlers = [];
  electronState.clickHandlers = [];
});

describe("sendNotification", () => {
  it("shows the notification and forwards the failure reason to the renderer", () => {
    const win = fakeWindow();
    sendNotification(win as unknown as BrowserWindow, baseOpts);

    expect(electronState.showCalls).toBe(1);
    expect(electronState.failedHandlers).toHaveLength(1);

    electronState.failedHandlers[0]({}, "denied");
    expect(win.webContents.send).toHaveBeenCalledWith("notification-failed", { reason: "denied" });
  });

  it("forwards click events to the renderer with the route payload", () => {
    const win = fakeWindow();
    sendNotification(win as unknown as BrowserWindow, baseOpts);

    electronState.clickHandlers[0]();
    expect(win.webContents.send).toHaveBeenCalledWith("notification-clicked", {
      feature_id: 1,
      project_id: 2,
      route_type: "workflow",
    });
  });

  it("emits a synthetic failure when the OS does not support notifications", () => {
    electronState.isSupported = false;
    const win = fakeWindow();
    sendNotification(win as unknown as BrowserWindow, baseOpts);

    expect(electronState.showCalls).toBe(0);
    expect(win.webContents.send).toHaveBeenCalledWith("notification-failed", {
      reason: "Notifications are not supported on this system.",
    });
  });

  it("does not crash if the window is destroyed before the failure fires", () => {
    const win = fakeWindow();
    sendNotification(win as unknown as BrowserWindow, baseOpts);

    win.destroyed = true;
    electronState.failedHandlers[0]({}, "denied");
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

describe("sendTestNotification", () => {
  it("shows a test notification and forwards failures", () => {
    const win = fakeWindow();
    sendTestNotification(win as unknown as BrowserWindow);

    expect(electronState.showCalls).toBe(1);
    electronState.failedHandlers[0]({}, "Focus mode");
    expect(win.webContents.send).toHaveBeenCalledWith("notification-failed", {
      reason: "Focus mode",
    });
  });

  it("falls back to 'Unknown error' when the failed event has no message", () => {
    const win = fakeWindow();
    sendTestNotification(win as unknown as BrowserWindow);

    electronState.failedHandlers[0]({}, "");
    expect(win.webContents.send).toHaveBeenCalledWith("notification-failed", {
      reason: "Unknown error",
    });
  });
});
