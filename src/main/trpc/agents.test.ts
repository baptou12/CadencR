import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "../test-utils";

const mockDb = createMockDb();

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));

const mockStopSubprocess = vi.fn().mockResolvedValue(true);
const mockNotifyDbUpdated = vi.fn();

vi.mock("../agents/subprocess-manager", () => ({
  startSubprocess: vi.fn(() => ({ id: "sub-1", agentType: "session", status: "running" })),
  stopSubprocess: mockStopSubprocess,
  interruptSubprocess: vi.fn().mockResolvedValue(true),
  listSubprocesses: vi.fn(() => []),
  submitUserAnswers: vi.fn(),
  submitPlanApproval: vi.fn(),
  submitPrdApproval: vi.fn(),
  submitToolPermission: vi.fn(),
  sendMessageToSubprocess: vi.fn(),
  setSubprocessPermissionMode: vi.fn(),
}));

vi.mock("../agents/effect-helpers", () => ({
  notifyDbUpdated: (...args: unknown[]) => mockNotifyDbUpdated(...args),
}));

vi.mock("../agents/types", () => ({}));

vi.mock("../agents/unified-agent", () => ({
  startUnifiedAgent: vi.fn().mockResolvedValue({ subprocessId: "sub-1", agentType: "session", sessionDbId: 1 }),
}));

vi.mock("../agents/execute-agent", () => ({
  buildPhaseCompletionAction: vi.fn(),
  processNextPhase: vi.fn(),
}));

vi.mock("../agents/mcp-factory", () => ({
  buildMcpServerFactoryForResume: vi.fn(),
}));

vi.mock("../agents/resolve-cwd", () => ({
  resolveAgentCwd: vi.fn().mockResolvedValue({ cwd: "/test", worktreePath: undefined }),
}));

const { agentsRouter } = await import("./agents");
const caller = agentsRouter.createCaller({});

describe("agentsRouter.clearSession", () => {
  const preparedStatements: Array<{ sql: string; get: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    preparedStatements.length = 0;

    mockDb.prepare.mockImplementation((sql: string) => {
      const stmt = { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 1 }), all: vi.fn().mockReturnValue([]) };
      preparedStatements.push({ sql, ...stmt });

      // SELECT claude_session_id, feature_id
      if (sql.includes("SELECT claude_session_id")) {
        stmt.get.mockReturnValue({ claude_session_id: "old-sdk-session", feature_id: 42 });
      }

      return stmt;
    });
  });

  it("archives claude_session_id and nulls it out AFTER stopping subprocess", async () => {
    const callOrder: string[] = [];

    // Track call order
    mockStopSubprocess.mockImplementation(async () => {
      callOrder.push("stopSubprocess");
      return true;
    });

    mockDb.prepare.mockImplementation((sql: string) => {
      const stmt = { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 1 }), all: vi.fn().mockReturnValue([]) };

      if (sql.includes("SELECT claude_session_id")) {
        stmt.get.mockReturnValue({ claude_session_id: "old-sdk-session", feature_id: 42 });
      }

      if (sql.includes("INSERT INTO session_claude_ids")) {
        const origRun = stmt.run;
        stmt.run = vi.fn((...args) => {
          callOrder.push("archive_session_id");
          return origRun(...args);
        });
      }

      if (sql.includes("UPDATE agent_sessions SET claude_session_id = NULL")) {
        const origRun = stmt.run;
        stmt.run = vi.fn((...args) => {
          callOrder.push("null_session_id");
          return origRun(...args);
        });
      }

      if (sql.includes("INSERT INTO agent_messages")) {
        const origRun = stmt.run;
        stmt.run = vi.fn((...args) => {
          callOrder.push("insert_divider");
          return origRun(...args);
        });
      }

      return stmt;
    });

    const result = await caller.clearSession({ subprocessId: "sub-1", sessionDbId: 100 });

    expect(result).toEqual({ success: true });

    // Verify ordering: null MUST come AFTER stopSubprocess
    // so pauseSubprocess (called by stop) can't overwrite our NULL
    expect(callOrder).toEqual([
      "archive_session_id",
      "insert_divider",
      "stopSubprocess",
      "null_session_id",
    ]);
  });

  it("inserts clear_divider message", async () => {
    await caller.clearSession({ subprocessId: "sub-1", sessionDbId: 100 });

    const insertCall = preparedStatements.find((s) => s.sql.includes("INSERT INTO agent_messages"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.sql).toContain("clear_divider");
    expect(insertCall!.run).toHaveBeenCalledWith(100);
  });

  it("archives old claude_session_id into session_claude_ids", async () => {
    await caller.clearSession({ subprocessId: "sub-1", sessionDbId: 100 });

    const archiveCall = preparedStatements.find((s) => s.sql.includes("INSERT INTO session_claude_ids"));
    expect(archiveCall).toBeDefined();
    expect(archiveCall!.run).toHaveBeenCalledWith(100, "old-sdk-session");
  });

  it("skips archive when claude_session_id is already null", async () => {
    mockDb.prepare.mockImplementation((sql: string) => {
      const stmt = { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 1 }), all: vi.fn().mockReturnValue([]) };
      if (sql.includes("SELECT claude_session_id")) {
        stmt.get.mockReturnValue({ claude_session_id: null, feature_id: 42 });
      }
      return stmt;
    });

    const result = await caller.clearSession({ subprocessId: "sub-1", sessionDbId: 100 });
    expect(result).toEqual({ success: true });

    // Should NOT have inserted into session_claude_ids
    const archiveCall = mockDb.prepare.mock.calls.find(
      (c: string[]) => typeof c[0] === "string" && c[0].includes("INSERT INTO session_claude_ids"),
    );
    expect(archiveCall).toBeUndefined();
  });

  it("works without subprocessId (already stopped)", async () => {
    const result = await caller.clearSession({ sessionDbId: 100 });

    expect(result).toEqual({ success: true });
    expect(mockStopSubprocess).not.toHaveBeenCalled();
  });

  it("returns failure when session not found", async () => {
    mockDb.prepare.mockImplementation((sql: string) => {
      const stmt = { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 1 }), all: vi.fn().mockReturnValue([]) };
      if (sql.includes("SELECT claude_session_id")) {
        stmt.get.mockReturnValue(undefined);
      }
      return stmt;
    });

    const result = await caller.clearSession({ sessionDbId: 999 });
    expect(result).toEqual({ success: false, reason: "session_not_found" });
  });

  it("broadcasts DB update notification", async () => {
    await caller.clearSession({ subprocessId: "sub-1", sessionDbId: 100 });
    expect(mockNotifyDbUpdated).toHaveBeenCalledWith("agent_session", 42);
  });
});
