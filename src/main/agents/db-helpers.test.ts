import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/database");
vi.mock("./session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));

import { updateSession, insertMessage, getSessionFeatureId } from "./db-helpers";
import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./session-persistence";
import { createMockDb } from "../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

describe("updateSession", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("updates specified fields and notifies renderer", () => {
    const runFn = vi.fn();
    db.prepare.mockReturnValue({ run: runFn });

    updateSession(1, { status: "completed" }, 10);

    expect(runFn).toHaveBeenCalledWith("completed", 1);
    expect(mockNotify).toHaveBeenCalledWith("agent_session", 10);
  });

  it("does nothing when fields is empty", () => {
    updateSession(1, {}, 10);
    expect(db.prepare).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips notification when featureId is undefined", () => {
    const runFn = vi.fn();
    db.prepare.mockReturnValue({ run: runFn });

    updateSession(1, { status: "running" });

    expect(runFn).toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("silently catches DB errors", () => {
    db.prepare.mockImplementation(() => { throw new Error("DB error"); });

    expect(() => updateSession(1, { status: "error" }, 10)).not.toThrow();
  });
});

describe("insertMessage", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("inserts a message and returns the new ID", () => {
    const runFn = vi.fn().mockReturnValue({ lastInsertRowid: 42 });
    db.prepare.mockReturnValue({ run: runFn });

    const id = insertMessage(1, {
      role: "assistant",
      content: "hello",
      messageType: "text",
    });

    expect(id).toBe(42);
    expect(runFn).toHaveBeenCalledWith(
      1, "assistant", "hello", "text", null, null, null
    );
  });

  it("passes tool fields when provided", () => {
    const runFn = vi.fn().mockReturnValue({ lastInsertRowid: 5 });
    db.prepare.mockReturnValue({ run: runFn });

    insertMessage(1, {
      role: "tool",
      content: "result",
      messageType: "tool_result",
      toolName: "bash",
      toolUseId: "tu1",
      parentToolUseId: "ptu1",
    });

    expect(runFn).toHaveBeenCalledWith(
      1, "tool", "result", "tool_result", "bash", "tu1", "ptu1"
    );
  });

  it("returns null on error", () => {
    db.prepare.mockImplementation(() => { throw new Error("DB error"); });

    const id = insertMessage(1, { role: "user", content: "x", messageType: "text" });

    expect(id).toBeNull();
  });
});

describe("getSessionFeatureId", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("returns feature_id when session exists", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ feature_id: 7 }) });

    expect(getSessionFeatureId(1)).toBe(7);
  });

  it("returns undefined when session not found", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

    expect(getSessionFeatureId(99)).toBeUndefined();
  });

  it("returns undefined on DB error", () => {
    db.prepare.mockImplementation(() => { throw new Error("DB error"); });

    expect(getSessionFeatureId(1)).toBeUndefined();
  });
});
