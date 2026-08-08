import { describe, expect, it } from "vitest";
import {
  createStartupWatchdog,
  recordStartupProgress,
  startupAbsoluteTimeoutMs,
  startupHealthIntervalMs,
  startupStallTimeoutMs,
  startupWatchdogFailure,
} from "./sidecar-health";

describe("sidecar startup watchdog", () => {
  it("refreshes its deadline whenever the service reports progress", () => {
    const watchdog = createStartupWatchdog(100);
    recordStartupProgress(watchdog, "backing_up", 500);
    expect(watchdog).toEqual({ phase: "backing_up", phaseStartedAt: 500, lastProgressAt: 500 });

    recordStartupProgress(watchdog, "backing_up", 1_000);
    expect(watchdog).toEqual({ phase: "backing_up", phaseStartedAt: 500, lastProgressAt: 1_000 });
  });

  it("gives database phases a much longer stall budget", () => {
    expect(startupStallTimeoutMs("backing_up")).toBeGreaterThan(
      startupStallTimeoutMs("starting_service"),
    );
    expect(startupStallTimeoutMs("compacting_database")).toBe(startupStallTimeoutMs("migrating"));
    expect(startupAbsoluteTimeoutMs("backing_up")).toBeGreaterThan(
      startupStallTimeoutMs("backing_up"),
    );
  });

  it("probes slowly while startup is known to be inside SQLite work", () => {
    expect(startupHealthIntervalMs("backing_up")).toBeGreaterThan(
      startupHealthIntervalMs("starting_service"),
    );
    expect(startupHealthIntervalMs("compacting_database")).toBe(
      startupHealthIntervalMs("migrating"),
    );
  });

  it("enforces an absolute phase deadline even while heartbeats continue", () => {
    const watchdog = createStartupWatchdog(0);
    recordStartupProgress(watchdog, "backing_up", 100);
    const deadline = startupAbsoluteTimeoutMs("backing_up");

    recordStartupProgress(watchdog, "backing_up", 100 + deadline - 1);
    expect(startupWatchdogFailure(watchdog, 100 + deadline)).toBe(
      "Startup deadline exceeded during backing_up",
    );
  });
});
