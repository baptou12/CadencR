import { afterEach, describe, expect, it, vi } from "vitest";
import { sendToWindow } from "./safe-send";

function fakeWindow(options?: { windowDestroyed?: boolean; contentsDestroyed?: boolean }) {
  return {
    isDestroyed: () => options?.windowDestroyed === true,
    webContents: {
      isDestroyed: () => options?.contentsDestroyed === true,
      send: vi.fn(),
    },
  };
}

describe("sendToWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send to a destroyed window", () => {
    const win = fakeWindow({ windowDestroyed: true });
    expect(sendToWindow(win, "app:close-requested")).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("swallows disposed-frame send errors", () => {
    const win = fakeWindow();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    win.webContents.send.mockImplementation(() => {
      throw new Error("Render frame was disposed before WebFrameMain could be accessed");
    });

    expect(sendToWindow(win, "app:close-requested")).toBe(false);
  });

  it("rethrows unexpected send errors", () => {
    const win = fakeWindow();
    win.webContents.send.mockImplementation(() => {
      throw new Error("unexpected ipc failure");
    });

    expect(() => sendToWindow(win, "app:close-requested")).toThrow("unexpected ipc failure");
  });
});
