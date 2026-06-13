import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserFocusGuard } from "./browser-focus-guard";

function makeWindow(focused: boolean) {
  const focus = vi.fn();
  const webContents = {
    isFocused: vi.fn(() => focused),
    focus,
    setFocused: (value: boolean) => webContents.isFocused.mockReturnValue(value),
  };
  return { isDestroyed: () => false, webContents };
}

// A guest webContents is just an event emitter for our purposes.
function makeGuest(): EventEmitter {
  return new EventEmitter();
}

describe("BrowserFocusGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reclaims renderer focus when a guest grabs it during an agent tool", async () => {
    const win = makeWindow(true);
    const guard = new BrowserFocusGuard(() => win as never);
    const guest = makeGuest();
    guard.watch(guest as never);

    await guard.run(async () => {
      // The guest steals focus mid-action (e.g. el.focus() in a fill).
      win.webContents.setFocused(false);
      guest.emit("focus");
    });

    expect(win.webContents.focus).toHaveBeenCalled();
  });

  it("leaves browser focus alone when the user was already in the guest", async () => {
    const win = makeWindow(false); // user is interacting with the browser
    const guard = new BrowserFocusGuard(() => win as never);
    const guest = makeGuest();
    guard.watch(guest as never);

    await guard.run(async () => {
      guest.emit("focus");
    });

    expect(win.webContents.focus).not.toHaveBeenCalled();
  });

  it("reclaims focus stolen just after the tool resolves, then stops", async () => {
    const win = makeWindow(true);
    const guard = new BrowserFocusGuard(() => win as never);
    const guest = makeGuest();
    guard.watch(guest as never);

    await guard.run(async () => undefined);
    win.webContents.focus.mockClear();

    // sendInputEvent-driven focus lands a tick after the call resolves.
    win.webContents.setFocused(false);
    guest.emit("focus");
    expect(win.webContents.focus).toHaveBeenCalledTimes(1);

    // Once the settle window elapses, a later guest focus is the user's.
    win.webContents.focus.mockClear();
    vi.advanceTimersByTime(1000);
    guest.emit("focus");
    expect(win.webContents.focus).not.toHaveBeenCalled();
  });
});
