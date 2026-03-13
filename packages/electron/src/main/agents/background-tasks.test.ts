import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock broadcast to avoid electron dependency
vi.mock("./broadcast", () => ({
  broadcast: vi.fn(),
  BACKGROUND_TASK_CHANNEL: "agent:background-tasks",
}));

import {
  addBackgroundTask,
  updateBackgroundTask,
  getBackgroundTasks,
  clearBackgroundTasks,
} from "./background-tasks";
import { broadcast } from "./broadcast";

const mockBroadcast = vi.mocked(broadcast);

const SUBPROCESS_ID = "sp-test-1";

function makeTask(overrides?: Partial<import("./background-tasks").BackgroundTask>): import("./background-tasks").BackgroundTask {
  return {
    id: "task-1",
    subprocessId: SUBPROCESS_ID,
    kind: "bash",
    status: "running",
    spawnedAt: Date.now(),
    ...overrides,
  };
}

describe("background-tasks", () => {
  beforeEach(() => {
    clearBackgroundTasks(SUBPROCESS_ID);
    mockBroadcast.mockClear();
  });

  describe("getBackgroundTasks", () => {
    it("returns empty array for unknown subprocess", () => {
      expect(getBackgroundTasks("unknown-id")).toEqual([]);
    });
  });

  describe("addBackgroundTask", () => {
    it("adds a task and returns it via getBackgroundTasks", () => {
      const task = makeTask();
      addBackgroundTask(SUBPROCESS_ID, task);
      const tasks = getBackgroundTasks(SUBPROCESS_ID);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ id: "task-1", kind: "bash", status: "running" });
    });

    it("broadcasts after adding", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask());
      expect(mockBroadcast).toHaveBeenCalledWith(
        "agent:background-tasks",
        expect.objectContaining({ subprocessId: SUBPROCESS_ID }),
      );
    });

    it("can add multiple tasks", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t1" }));
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t2", kind: "agent" }));
      expect(getBackgroundTasks(SUBPROCESS_ID)).toHaveLength(2);
    });
  });

  describe("updateBackgroundTask", () => {
    it("updates a task by id", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t1" }));
      updateBackgroundTask(SUBPROCESS_ID, "t1", { status: "completed", completedAt: 12345 });
      const tasks = getBackgroundTasks(SUBPROCESS_ID);
      expect(tasks[0].status).toBe("completed");
      expect(tasks[0].completedAt).toBe(12345);
    });

    it("updates a task by tempId", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "temp-abc", tempId: "temp-abc" }));
      updateBackgroundTask(SUBPROCESS_ID, "temp-abc", { id: "real-shell-id" });
      const tasks = getBackgroundTasks(SUBPROCESS_ID);
      expect(tasks[0].id).toBe("real-shell-id");
    });

    it("does nothing for unknown subprocess", () => {
      expect(() => updateBackgroundTask("no-such-sp", "t1", { status: "completed" })).not.toThrow();
    });

    it("does nothing for unknown task ID", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t1" }));
      updateBackgroundTask(SUBPROCESS_ID, "not-exist", { status: "failed" });
      expect(getBackgroundTasks(SUBPROCESS_ID)[0].status).toBe("running");
    });

    it("broadcasts after updating", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t1" }));
      mockBroadcast.mockClear();
      updateBackgroundTask(SUBPROCESS_ID, "t1", { status: "completed" });
      expect(mockBroadcast).toHaveBeenCalledWith(
        "agent:background-tasks",
        expect.objectContaining({ subprocessId: SUBPROCESS_ID }),
      );
    });
  });

  describe("clearBackgroundTasks", () => {
    it("removes all tasks for subprocess", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t1" }));
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t2" }));
      clearBackgroundTasks(SUBPROCESS_ID);
      expect(getBackgroundTasks(SUBPROCESS_ID)).toHaveLength(0);
    });

    it("does not affect other subprocesses", () => {
      addBackgroundTask(SUBPROCESS_ID, makeTask({ id: "t1" }));
      addBackgroundTask("other-sp", makeTask({ id: "t2", subprocessId: "other-sp" }));
      clearBackgroundTasks(SUBPROCESS_ID);
      expect(getBackgroundTasks("other-sp")).toHaveLength(1);
      // cleanup
      clearBackgroundTasks("other-sp");
    });
  });
});
