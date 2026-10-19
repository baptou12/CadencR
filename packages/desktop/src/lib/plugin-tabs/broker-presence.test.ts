import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_RENEW_MS, PresenceLease, type PresenceDeps } from "./broker-presence";

function deps(overrides: Partial<PresenceDeps> = {}): PresenceDeps {
  return {
    renew: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    report: vi.fn(),
    newLeaseId: () => "lease-1",
    ...overrides,
  };
}

describe("PresenceLease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews every minute while open, idle or not, and releases on close", async () => {
    const presence = deps();
    const lease = new PresenceLease("ports", 7, "Ports", presence);
    expect(presence.renew).toHaveBeenCalledWith("ports", "lease-1", 7);
    await vi.advanceTimersByTimeAsync(PRESENCE_RENEW_MS * 30);
    expect(presence.renew).toHaveBeenCalledTimes(31);
    lease.dispose();
    lease.dispose();
    await vi.advanceTimersByTimeAsync(PRESENCE_RENEW_MS * 3);
    expect(presence.renew).toHaveBeenCalledTimes(31);
    expect(presence.release).toHaveBeenCalledTimes(1);
    expect(presence.release).toHaveBeenCalledWith("ports", "lease-1");
  });

  it("releases only after a renewal in flight, so the lease cannot come back", async () => {
    let finish: () => void = () => undefined;
    const order: string[] = [];
    const presence = deps({
      renew: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              order.push("renewed");
              resolve();
            };
          }),
      ),
      release: vi.fn(async () => {
        order.push("released");
      }),
    });
    new PresenceLease("ports", 7, "Ports", presence).dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(presence.release).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["renewed", "released"]);
  });

  it("reports one failure per streak, and a failed release", async () => {
    const failure = new Error("offline");
    let up = false;
    const presence = deps({
      renew: vi.fn(async () => {
        if (!up) throw failure;
      }),
      release: vi.fn(async () => Promise.reject(failure)),
    });
    const lease = new PresenceLease("ports", 7, "Ports", presence);
    await vi.advanceTimersByTimeAsync(PRESENCE_RENEW_MS * 2);
    expect(presence.report).toHaveBeenCalledTimes(1);
    up = true;
    await vi.advanceTimersByTimeAsync(PRESENCE_RENEW_MS);
    up = false;
    await vi.advanceTimersByTimeAsync(PRESENCE_RENEW_MS);
    expect(presence.report).toHaveBeenCalledTimes(2);
    lease.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(presence.report).toHaveBeenLastCalledWith(
      expect.stringContaining("could not be stopped right away"),
      failure,
    );
  });
});
