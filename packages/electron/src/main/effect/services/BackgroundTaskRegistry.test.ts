import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { BackgroundTaskRegistry, BackgroundTaskRegistryLive } from "./BackgroundTaskRegistry.js";
import type { BackgroundTask } from "../../agents/background-tasks.js";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    subprocessId: "sub-1",
    kind: "bash",
    status: "running",
    spawnedAt: Date.now(),
    ...overrides,
  };
}

describe("BackgroundTaskRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("add and getBySubprocess", () => {
    // Need a fresh layer per test to avoid shared state
    const layer = BackgroundTaskRegistryLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const reg = yield* BackgroundTaskRegistry;
          yield* reg.add(makeTask({ id: "t1", subprocessId: "s1" }));
          yield* reg.add(makeTask({ id: "t2", subprocessId: "s1" }));
          yield* reg.add(makeTask({ id: "t3", subprocessId: "s2" }));
          const s1Tasks = yield* reg.getBySubprocess("s1");
          const s2Tasks = yield* reg.getBySubprocess("s2");
          const s3Tasks = yield* reg.getBySubprocess("s3");
          return { s1: s1Tasks.length, s2: s2Tasks.length, s3: s3Tasks.length };
        }),
        layer,
      ),
    );
    expect(result).toEqual({ s1: 2, s2: 1, s3: 0 });
  });

  it("update matches by id", () => {
    const layer = BackgroundTaskRegistryLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const reg = yield* BackgroundTaskRegistry;
          yield* reg.add(makeTask({ id: "t1", subprocessId: "s1" }));
          yield* reg.update("s1", "t1", { status: "completed", completedAt: 123 });
          const tasks = yield* reg.getBySubprocess("s1");
          return tasks[0];
        }),
        layer,
      ),
    );
    expect(result.status).toBe("completed");
    expect(result.completedAt).toBe(123);
  });

  it("update matches by tempId", () => {
    const layer = BackgroundTaskRegistryLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const reg = yield* BackgroundTaskRegistry;
          yield* reg.add(makeTask({ id: "t1", tempId: "temp-1", subprocessId: "s1" }));
          yield* reg.update("s1", "temp-1", { id: "real-id" });
          const tasks = yield* reg.getBySubprocess("s1");
          return tasks[0];
        }),
        layer,
      ),
    );
    expect(result.id).toBe("real-id");
  });

  it("clear removes all tasks for a subprocess", () => {
    const layer = BackgroundTaskRegistryLive;
    const result = Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const reg = yield* BackgroundTaskRegistry;
          yield* reg.add(makeTask({ id: "t1", subprocessId: "s1" }));
          yield* reg.add(makeTask({ id: "t2", subprocessId: "s1" }));
          yield* reg.clear("s1");
          return yield* reg.getBySubprocess("s1");
        }),
        layer,
      ),
    );
    expect(result).toEqual([]);
  });

  it("getBySubprocess returns empty array for unknown subprocess", () => {
    const layer = BackgroundTaskRegistryLive;
    const result = Effect.runSync(
      Effect.provide(
        BackgroundTaskRegistry.getBySubprocess("unknown"),
        layer,
      ),
    );
    expect(result).toEqual([]);
  });
});
