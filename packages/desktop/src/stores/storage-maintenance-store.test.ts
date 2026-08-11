import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyStorageMaintenanceEvent,
  clearStorageMaintenanceStatus,
  parseStorageMaintenanceStatus,
  useStorageMaintenanceStore,
} from "./storage-maintenance-store";

describe("storage maintenance store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStorageMaintenanceStatus();
  });

  afterEach(() => {
    clearStorageMaintenanceStatus();
    vi.useRealTimers();
  });

  it("parses determinate optimization progress", () => {
    expect(
      parseStorageMaintenanceStatus({
        phase: "progress",
        task: "optimization",
        completed: 25,
        total: 100,
      }),
    ).toEqual({ phase: "progress", task: "optimization", completed: 25, total: 100 });
  });

  it("rejects malformed and impossible progress", () => {
    expect(
      parseStorageMaintenanceStatus({
        phase: "progress",
        task: "cleanup",
        completed: 11,
        total: 10,
      }),
    ).toBeNull();
    expect(parseStorageMaintenanceStatus({ phase: "started", task: "cleanup" })).toBeNull();
  });

  it("surfaces malformed events before clearing the failure", () => {
    applyStorageMaintenanceEvent({ phase: "progress", task: "cleanup", total: "ten" });

    expect(useStorageMaintenanceStore.getState().status).toEqual({
      task: "unknown",
      phase: "failed",
      completed: 0,
      total: 0,
    });
    vi.advanceTimersByTime(3_999);
    expect(useStorageMaintenanceStore.getState().status?.phase).toBe("failed");
    vi.advanceTimersByTime(1);
    expect(useStorageMaintenanceStore.getState().status).toBeNull();
  });

  it("keeps progress current and briefly confirms completion", () => {
    applyStorageMaintenanceEvent({
      phase: "started",
      task: "cleanup",
      completed: 0,
      total: 8,
    });
    applyStorageMaintenanceEvent({
      phase: "progress",
      task: "cleanup",
      completed: 3,
      total: 8,
    });
    expect(useStorageMaintenanceStore.getState().status?.completed).toBe(3);

    applyStorageMaintenanceEvent({
      phase: "completed",
      task: "cleanup",
      completed: 8,
      total: 8,
    });
    vi.advanceTimersByTime(3_999);
    expect(useStorageMaintenanceStore.getState().status?.phase).toBe("completed");
    vi.advanceTimersByTime(1);
    expect(useStorageMaintenanceStore.getState().status).toBeNull();
  });

  it("cancels a pending clear when a new task starts", () => {
    applyStorageMaintenanceEvent({
      phase: "completed",
      task: "optimization",
      completed: 10,
      total: 10,
    });
    applyStorageMaintenanceEvent({
      phase: "started",
      task: "cleanup",
      completed: 0,
      total: 4,
    });

    vi.advanceTimersByTime(10_000);
    expect(useStorageMaintenanceStore.getState().status).toEqual({
      phase: "started",
      task: "cleanup",
      completed: 0,
      total: 4,
    });
  });

  it("does not notify subscribers for a duplicate socket update", () => {
    const listener = vi.fn();
    const unsubscribe = useStorageMaintenanceStore.subscribe(listener);
    const event = {
      phase: "progress",
      task: "cleanup",
      completed: 2,
      total: 8,
    } as const;

    applyStorageMaintenanceEvent(event);
    applyStorageMaintenanceEvent(event);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
