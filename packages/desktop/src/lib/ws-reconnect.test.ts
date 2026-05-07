import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleReconnect,
  resetReconnectDelay,
  clearReconnect,
  registerReconnector,
  unregisterReconnector,
  forceReconnect,
  forceReconnectAll,
} from "./ws-reconnect";

describe("ws-reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearReconnect("test");
    clearReconnect("other");
    vi.useRealTimers();
  });

  it("calls connect after base delay", () => {
    const connect = vi.fn();
    scheduleReconnect("test", connect);

    expect(connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(connect).toHaveBeenCalledOnce();
  });

  it("doubles delay on successive calls", () => {
    const connect = vi.fn();

    scheduleReconnect("test", connect);
    vi.advanceTimersByTime(1000);
    expect(connect).toHaveBeenCalledTimes(1);

    scheduleReconnect("test", connect);
    vi.advanceTimersByTime(1999);
    expect(connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("caps delay at 30s", () => {
    const connect = vi.fn();
    // Schedule and fire many times to exceed max
    for (let i = 0; i < 20; i++) {
      scheduleReconnect("test", connect);
      vi.advanceTimersByTime(30000);
    }
    // Next schedule should still fire within 30s
    scheduleReconnect("test", connect);
    vi.advanceTimersByTime(30000);
    expect(connect).toHaveBeenCalledTimes(21);
  });

  it("deduplicates concurrent schedules", () => {
    const connect = vi.fn();
    scheduleReconnect("test", connect);
    scheduleReconnect("test", connect);
    scheduleReconnect("test", connect);

    vi.advanceTimersByTime(1000);
    expect(connect).toHaveBeenCalledOnce();
  });

  it("resetReconnectDelay resets to base", () => {
    const connect = vi.fn();

    // Schedule twice to double the delay
    scheduleReconnect("test", connect);
    vi.advanceTimersByTime(1000);
    scheduleReconnect("test", connect);
    vi.advanceTimersByTime(2000);

    // Reset and schedule — should be back to 1s
    resetReconnectDelay("test");
    scheduleReconnect("test", connect);
    vi.advanceTimersByTime(1000);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("clearReconnect cancels pending timer", () => {
    const connect = vi.fn();
    scheduleReconnect("test", connect);
    clearReconnect("test");

    vi.advanceTimersByTime(5000);
    expect(connect).not.toHaveBeenCalled();
  });

  it("isolates keys from each other", () => {
    const connectA = vi.fn();
    const connectB = vi.fn();

    scheduleReconnect("test", connectA);
    scheduleReconnect("other", connectB);

    clearReconnect("test");
    vi.advanceTimersByTime(1000);

    expect(connectA).not.toHaveBeenCalled();
    expect(connectB).toHaveBeenCalledOnce();
  });

  describe("forceReconnect / registerReconnector", () => {
    afterEach(() => {
      clearReconnect("force-a");
      clearReconnect("force-b");
    });

    it("forceReconnect invokes the registered connector immediately", () => {
      const connect = vi.fn();
      registerReconnector("force-a", connect);
      forceReconnect("force-a");
      expect(connect).toHaveBeenCalledTimes(1);
    });

    it("forceReconnect cancels a pending scheduled timer", () => {
      const connect = vi.fn();
      scheduleReconnect("force-a", connect);
      forceReconnect("force-a");
      expect(connect).toHaveBeenCalledTimes(1);
      // Pending timer should not fire a second time.
      vi.advanceTimersByTime(2000);
      expect(connect).toHaveBeenCalledTimes(1);
    });

    it("forceReconnect resets backoff to base", () => {
      const connect = vi.fn();
      // Push delay up to 2s.
      scheduleReconnect("force-a", connect);
      vi.advanceTimersByTime(1000);
      scheduleReconnect("force-a", connect);
      vi.advanceTimersByTime(2000);
      expect(connect).toHaveBeenCalledTimes(2);

      forceReconnect("force-a"); // also resets to base.
      scheduleReconnect("force-a", connect);
      vi.advanceTimersByTime(1000);
      expect(connect).toHaveBeenCalledTimes(4);
    });

    it("forceReconnect on an unknown key is a no-op", () => {
      expect(() => forceReconnect("missing")).not.toThrow();
    });

    it("forceReconnectAll triggers every registered connector once", () => {
      const a = vi.fn();
      const b = vi.fn();
      registerReconnector("force-a", a);
      registerReconnector("force-b", b);
      forceReconnectAll();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it("unregisterReconnector removes a key from forceReconnectAll", () => {
      const a = vi.fn();
      registerReconnector("force-a", a);
      unregisterReconnector("force-a");
      forceReconnectAll();
      expect(a).not.toHaveBeenCalled();
    });
  });
});
