import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../test-utils";

const mockDb = createMockDb();

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));

vi.mock("../agents/session-persistence", () => ({
  getSubprocessIdsForSessionDbIds: vi.fn().mockReturnValue([]),
  getSubprocessIdForSession: vi.fn().mockReturnValue(null),
}));

vi.mock("../agents/subprocess-manager", () => ({
  stopSubprocess: vi.fn().mockResolvedValue(true),
  startSubprocess: vi.fn(),
  interruptSubprocess: vi.fn(),
  listSubprocesses: vi.fn().mockReturnValue([]),
  submitUserAnswers: vi.fn(),
  submitPlanApproval: vi.fn(),
  submitToolPermission: vi.fn(),
  sendMessageToSubprocess: vi.fn(),
  setSubprocessPermissionMode: vi.fn(),
  getSupportedCommands: vi.fn().mockReturnValue([]),
}));

const { featuresRouter } = await import("./features");
const caller = featuresRouter.createCaller({});

describe("featuresRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 5 }),
    }));
  });

  describe("listByProject", () => {
    it("returns features for a project", async () => {
      const rows = [
        { id: 1, project_id: 1, title: "Feature A", status: "draft", type: "feature", created_at: "2024-01-01" },
      ];
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });
      const result = await caller.listByProject({ project_id: 1 });
      expect(result).toEqual(rows);
    });

    it("filters by status when provided", async () => {
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
      await caller.listByProject({ project_id: 1, status: "in-progress" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("AND status = ?"));
    });

    it("does not filter when status is not provided", async () => {
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
      await caller.listByProject({ project_id: 1 });
      const call = mockDb.prepare.mock.calls[0][0] as string;
      expect(call).not.toContain("AND status = ?");
    });
  });

  describe("create", () => {
    it("creates a feature with explicit title", async () => {
      const result = await caller.create({ project_id: 1, title: "My Feature" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO features"));
      expect(result).toEqual({ id: 5 });
    });

    it("auto-generates title when none provided", async () => {
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue({ max_num: 3 }),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 6 }),
      }));
      const result = await caller.create({ project_id: 1 });
      expect(result).toEqual({ id: 6 });
    });

    it("starts from Session 1 when no sessions exist", async () => {
      let callCount = 0;
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          if (callCount++ === 0) return { max_num: null };
          return undefined;
        }),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }),
      }));
      const result = await caller.create({ project_id: 1 });
      expect(result).toEqual({ id: 1 });
    });
  });

  describe("createSession", () => {
    it("creates a session-type feature", async () => {
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue({ max_num: 2 }),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 7 }),
      }));
      const result = await caller.createSession({ project_id: 1 });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("'session'"));
      expect(result).toEqual({ id: 7 });
    });
  });

  describe("updateStatus", () => {
    it("updates feature status", async () => {
      const result = await caller.updateStatus({ id: 1, status: "in-progress" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE features SET status"));
      expect(result).toEqual({ success: true });
    });

    it("rejects invalid status", async () => {
      await expect(caller.updateStatus({ id: 1, status: "invalid" as any })).rejects.toThrow();
    });
  });

  describe("updateTitle", () => {
    it("updates feature title", async () => {
      const result = await caller.updateTitle({ id: 1, title: "New Title" });
      expect(result).toEqual({ success: true });
    });
  });

  describe("delete", () => {
    it("deletes feature and all child records", async () => {
      // Mock: running sessions returns empty, plans returns empty
      const runMock = vi.fn().mockReturnValue({ changes: 1 });
      const allMock = vi.fn().mockReturnValue([]);
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue(undefined),
        all: allMock,
        run: runMock,
      }));
      const result = await caller.delete({ id: 1 });
      expect(result).toEqual({ success: true });
      // Should have deleted from multiple tables
      const deleteCalls = mockDb.prepare.mock.calls.filter((c: any[]) => c[0].includes("DELETE"));
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    it("stops running subprocesses before deleting", async () => {
      const { getSubprocessIdsForSessionDbIds } = await import("../agents/session-persistence");
      const { stopSubprocess } = await import("../agents/subprocess-manager");
      vi.mocked(getSubprocessIdsForSessionDbIds).mockReturnValue(["proc-1"]);
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn().mockImplementation((arg: unknown) => {
          // Return a running session on the first call (SELECT id FROM agent_sessions)
          return [{ id: 10 }];
        }),
        run: vi.fn().mockReturnValue({ changes: 1 }),
      }));
      await caller.delete({ id: 1 });
      expect(stopSubprocess).toHaveBeenCalledWith("proc-1");
    });
  });

  describe("getById", () => {
    it("returns a feature by id", async () => {
      const row = { id: 1, project_id: 1, title: "Feat", status: "draft", type: "feature", created_at: "2024-01-01" };
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(row) });
      const result = await caller.getById({ id: 1 });
      expect(result).toEqual(row);
    });

    it("returns null when not found", async () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
      const result = await caller.getById({ id: 999 });
      expect(result).toBeNull();
    });
  });

  describe("getPlanProgress / getProgress", () => {
    it("returns zeros when no plan", async () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
      expect(await caller.getPlanProgress({ feature_id: 1 })).toEqual({ total: 0, done: 0 });
      expect(await caller.getProgress({ feature_id: 1 })).toEqual({ total: 0, done: 0 });
    });

    it("returns phase counts when plan exists", async () => {
      let callCount = 0;
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          const results = [
            { id: 10 },       // plan
            { count: 5 },      // total phases
            { count: 3 },      // done phases
          ];
          return results[callCount++] ?? undefined;
        }),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      }));
      const result = await caller.getPlanProgress({ feature_id: 1 });
      expect(result).toEqual({ total: 5, done: 3 });
    });
  });

  describe("getPlanWithPhases", () => {
    it("returns null when no plan found", async () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
      const result = await caller.getPlanWithPhases({ feature_id: 1 });
      expect(result).toBeNull();
    });

    it("returns plan with phases", async () => {
      let callCount = 0;
      const plan = { id: 1, feature_id: 1, title: "Plan", status: "draft", raw_markdown: "", created_at: "2024-01-01", updated_at: "2024-01-01" };
      const phases = [{ id: 1, plan_id: 1, step_number: 1, title: "Phase 1", status: "pending", complexity: null, commit_message: null, prompt: "", order_index: 0, implementation_notes: null, deviations: null, phase_type: "execute" }];
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          if (callCount++ === 0) return plan;
          return undefined;
        }),
        all: vi.fn().mockReturnValue(phases),
        run: vi.fn(),
      }));
      const result = await caller.getPlanWithPhases({ feature_id: 1 });
      expect(result).toMatchObject({ ...plan, phases });
    });
  });

  describe("getSettings", () => {
    it("returns combined feature columns and EAV settings", async () => {
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue({ model_plan: "claude-3", model_brainstorm: null, model_execute: null, model_risk: null, model_review: null, model_session: null, model_qa: null, agent_autonomy: "1" }),
        all: vi.fn().mockReturnValue([{ key: "worktree_path", value: "/path" }]),
        run: vi.fn(),
      }));
      const result = await caller.getSettings({ feature_id: 1 });
      expect(result["model_plan"]).toBe("claude-3");
      expect(result["agent_autonomy"]).toBe("1");
      expect(result["worktree_path"]).toBe("/path");
    });
  });

  describe("setSetting", () => {
    it("updates real column for known keys", async () => {
      const result = await caller.setSetting({ feature_id: 1, key: "model_execute", value: "claude-sonnet" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE features SET"));
      expect(result).toEqual({ success: true });
    });

    it("upserts EAV for unknown keys", async () => {
      const result = await caller.setSetting({ feature_id: 1, key: "worktree_path", value: "/path" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO feature_settings"));
      expect(result).toEqual({ success: true });
    });
  });

  describe("getModelSettings", () => {
    it("returns model settings with empty defaults", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ model_plan: "claude-3", model_brainstorm: null, model_execute: null, model_risk: null, model_review: null, model_session: null, model_qa: null }),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      });
      const result = await caller.getModelSettings({ featureId: 1 });
      expect(result["plan"]).toBe("claude-3");
      expect(result["brainstorm"]).toBe("");
    });
  });

  describe("setModelSetting", () => {
    it("updates model column", async () => {
      const result = await caller.setModelSetting({ featureId: 1, agentType: "plan", modelId: "claude-opus" });
      expect(result).toEqual({ success: true });
    });
  });

  describe("resetPhase", () => {
    it("throws when phase not found", async () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn(), all: vi.fn().mockReturnValue([]) });
      await expect(caller.resetPhase({ phase_id: 999 })).rejects.toThrow("Phase not found");
    });

    it("throws when phase is not completed or error", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ id: 1, plan_id: 1, step_number: 1, status: "pending" }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      });
      await expect(caller.resetPhase({ phase_id: 1 })).rejects.toThrow("Can only reset phases");
    });

    it("throws when next phase is already completed", async () => {
      let callCount = 0;
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          if (callCount++ === 0) return { id: 1, plan_id: 1, step_number: 1, status: "completed" };
          return { id: 2, status: "completed" }; // next phase is completed
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }));
      await expect(caller.resetPhase({ phase_id: 1 })).rejects.toThrow("Cannot reset a phase");
    });

    it("resets phase status and clears sessions", async () => {
      let callCount = 0;
      const runMock = vi.fn().mockReturnValue({ changes: 1 });
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          if (callCount++ === 0) return { id: 1, plan_id: 1, step_number: 1, status: "completed" };
          return undefined; // no next phase
        }),
        run: runMock,
        all: vi.fn().mockReturnValue([]),
      }));
      const result = await caller.resetPhase({ phase_id: 1 });
      expect(result).toEqual({ success: true });
      // Should have run multiple DELETE/UPDATE statements
      expect(runMock).toHaveBeenCalled();
    });
  });
});
