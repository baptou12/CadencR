import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../test-utils";

const mockDb = createMockDb();

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));

// Import after mocks
const { diffCommentsRouter } = await import("./diff-comments");
const caller = diffCommentsRouter.createCaller({});


describe("diffCommentsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 42 }),
    }));
  });

  describe("create", () => {
    it("inserts a new diff comment and returns it", async () => {
      const result = await caller.create({
        featureId: 1,
        filePath: "src/foo.ts",
        lineNumber: 10,
        side: "new",
        content: "Nice change!",
      });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO diff_comments"));
      expect(result).toMatchObject({
        id: 42,
        featureId: 1,
        filePath: "src/foo.ts",
        lineNumber: 10,
        side: "new",
        content: "Nice change!",
        status: "pending",
      });
    });

    it("rejects invalid side enum", async () => {
      await expect(
        caller.create({ featureId: 1, filePath: "f", lineNumber: 1, side: "invalid" as any, content: "x" }),
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    it("returns all comments for a feature", async () => {
      const rows = [
        { id: 1, feature_id: 1, file_path: "a.ts", line_number: 5, side: "new", content: "c", status: "pending", created_at: "2024-01-01" },
      ];
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });
      const result = await caller.list({ featureId: 1 });
      expect(result).toEqual(rows);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
    });

    it("returns empty array when no comments", async () => {
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
      const result = await caller.list({ featureId: 99 });
      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("updates content only", async () => {
      const result = await caller.update({ id: 1, content: "updated" });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE diff_comments"));
      expect(result).toEqual({ success: true });
    });

    it("updates status only", async () => {
      const result = await caller.update({ id: 1, status: "resolved" });
      expect(result).toEqual({ success: true });
    });

    it("updates both content and status", async () => {
      const result = await caller.update({ id: 1, content: "new", status: "sent" });
      expect(result).toEqual({ success: true });
    });

    it("throws when no fields to update", async () => {
      await expect(caller.update({ id: 1 })).rejects.toThrow("No fields to update");
    });

    it("rejects invalid status enum", async () => {
      await expect(caller.update({ id: 1, status: "bad" as any })).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("deletes a comment by id", async () => {
      const result = await caller.delete({ id: 5 });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM diff_comments WHERE id"));
      expect(result).toEqual({ success: true });
    });
  });

  describe("markAsSent", () => {
    it("marks pending comments as sent for a feature", async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 3 }) });
      const result = await caller.markAsSent({ featureId: 1 });
      expect(result).toEqual({ updated: 3 });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE diff_comments SET status = 'sent'"));
    });
  });

  describe("deletePending", () => {
    it("deletes pending comments for a feature", async () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 2 }) });
      const result = await caller.deletePending({ featureId: 1 });
      expect(result).toEqual({ deleted: 2 });
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM diff_comments WHERE feature_id"));
    });
  });
});
