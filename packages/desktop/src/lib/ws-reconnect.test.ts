import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scheduleReconnect, resetReconnectDelay, clearReconnect } from "./ws-reconnect";

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
});
