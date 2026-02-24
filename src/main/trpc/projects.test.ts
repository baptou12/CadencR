import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../test-utils";

const mockDb = createMockDb();

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    showSaveDialog: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

vi.mock("../agents/types", () => ({}));

const { projectsRouter } = await import("./projects");
const caller = projectsRouter.createCaller({});

describe("projectsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 10 }),
    }));
  });

  describe("list", () => {
    it("returns all projects ordered by created_at", async () => {
      const rows = [
        { id: 1, name: "Proj A", path: "/a", created_at: "2024-01-02" },
        { id: 2, name: "Proj B", path: "/b", created_at: "2024-01-01" },
      ];
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });
      const result = await caller.list();
      expect(result).toEqual(rows);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
    });

    it("returns empty array when no projects", async () => {
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
      expect(await caller.list()).toEqual([]);
    });
  });

  describe("create", () => {
    it("inserts a project and returns id", async () => {
      const result = await caller.create({ name: "My Proj", path: "/my/proj" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO projects"));
      expect(result).toEqual({ id: 10 });
    });
  });

  describe("delete", () => {
    it("deletes a project by id", async () => {
      const result = await caller.delete({ id: 3 });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM projects WHERE id"));
      expect(result).toEqual({ success: true });
    });
  });

  describe("selectFolder", () => {
    it("returns null when dialog is cancelled", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
      const result = await caller.selectFolder();
      expect(result).toBeNull();
    });

    it("returns name and path when folder is selected", async () => {
      const { dialog } = await import("electron");
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ["/some/project/folder"] });
      const result = await caller.selectFolder();
      expect(result).toEqual({ name: "folder", path: "/some/project/folder" });
    });
  });

  describe("getSettings", () => {
    it("returns combined project columns and EAV rows", async () => {
      let callCount = 0;
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockImplementation(() => {
          if (callCount++ === 0) return { branch_prefix: "feat/", qa_prompt: null, agent_autonomy: "2", model_plan: null, model_brainstorm: null, model_prd: null, model_execute: null, model_risk: null, model_review: null, model_session: null, model_qa: null };
          return undefined;
        }),
        all: vi.fn().mockReturnValue([{ key: "custom_key", value: "custom_val" }]),
        run: vi.fn(),
      }));
      const result = await caller.getSettings({ project_id: 1 });
      expect(result["branch_prefix"]).toBe("feat/");
      expect(result["agent_autonomy"]).toBe("2");
      expect(result["custom_key"]).toBe("custom_val");
    });

    it("returns empty object when project not found", async () => {
      mockDb.prepare.mockImplementation(() => ({
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      }));
      const result = await caller.getSettings({ project_id: 999 });
      expect(result).toEqual({});
    });
  });

  describe("setSetting", () => {
    it("updates real column for known keys", async () => {
      const result = await caller.setSetting({ project_id: 1, key: "model_plan", value: "claude-3" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE projects SET"));
      expect(result).toEqual({ success: true });
    });

    it("uses upsert EAV for unknown keys", async () => {
      const result = await caller.setSetting({ project_id: 1, key: "custom_setting", value: "val" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO project_settings"));
      expect(result).toEqual({ success: true });
    });
  });

  describe("getModelSettings", () => {
    it("returns model settings with empty string defaults", async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ model_plan: "claude-3", model_brainstorm: null, model_prd: null, model_execute: null, model_risk: null, model_review: null, model_session: null, model_qa: null }),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      });
      const result = await caller.getModelSettings({ projectId: 1 });
      expect(result["plan"]).toBe("claude-3");
      expect(result["brainstorm"]).toBe("");
    });
  });

  describe("setModelSetting", () => {
    it("updates model column for agent type", async () => {
      const result = await caller.setModelSetting({ projectId: 1, agentType: "execute", modelId: "claude-sonnet" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE projects SET"));
      expect(result).toEqual({ success: true });
    });

    it("rejects invalid agent type", async () => {
      await expect(
        caller.setModelSetting({ projectId: 1, agentType: "invalid" as any, modelId: "x" }),
      ).rejects.toThrow();
    });
  });
});
