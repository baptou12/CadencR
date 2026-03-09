/**
 * Tests for the tool-permissions module.
 *
 * After the ToolPermissions Effect service migration, these tests mock
 * getAppRuntime() to return a mock runtime that delegates to mock service methods.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("./effect-helpers", () => ({
  getSessionDbId: vi.fn(),
  notifyDbUpdated: vi.fn(),
}));

vi.mock("./permissions", () => ({
  resolvePermission: vi.fn(),
  appendToSettingsLocal: vi.fn(),
}));

// Mock the ToolPermissions service and getAppRuntime
const mockRuntime = {
  runSync: vi.fn(),
  runPromise: vi.fn(),
};

vi.mock("../effect/app-runtime-ref", () => ({
  getAppRuntime: vi.fn(() => mockRuntime),
}));

vi.mock("../effect/services/ToolPermissions", () => ({
  ToolPermissions: { key: "ToolPermissions" },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getDatabase } from "../db/database";
import { getSessionDbId } from "./effect-helpers";
import { resolvePermission, appendToSettingsLocal } from "./permissions";
import {
  createCanUseToolHandler,
  submitToolPermission,
  submitUserAnswers,
  submitPlanApproval,
  requestUserAnswers,
} from "./tool-permissions";
import type { ManagedSubprocess } from "./subprocess-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDb() {
  const stmt = { run: vi.fn(), get: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = { prepare: vi.fn(() => stmt) } as any;
  return { db, stmt };
}

function makeManaged(overrides?: Partial<ManagedSubprocess>): ManagedSubprocess {
  return {
    id: "test-subprocess-id",
    worktreePath: "/home/user/project/worktree",
    cachedPermissions: new Set<string>(),
    query: null,
    process: null,
    featureId: 1,
    agentType: "execute",
    isRunning: false,
    ...overrides,
  } as unknown as ManagedSubprocess;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionDbId).mockReturnValue(undefined);
  // By default, runPromise resolves with a default value
  mockRuntime.runPromise.mockResolvedValue(undefined);
  mockRuntime.runSync.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// createCanUseToolHandler
// ---------------------------------------------------------------------------

describe("createCanUseToolHandler", () => {
  describe("smart permission resolution with worktreePath", () => {
    it("allows tool when resolvePermission returns 'allow'", async () => {
      vi.mocked(resolvePermission).mockReturnValue("allow");
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/some/file.ts" });

      expect(result.behavior).toBe("allow");
    });

    it("denies tool when resolvePermission returns PermissionDeny", async () => {
      vi.mocked(resolvePermission).mockReturnValue({
        denied: true,
        reason: "Access denied to system files",
      });
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/etc/shadow" });

      expect(result.behavior).toBe("deny");
      expect((result as { behavior: "deny"; message: string }).message).toBe(
        "Access denied to system files"
      );
    });

    it("requests permission when resolvePermission returns needs_prompt, then allows on allow_once", async () => {
      vi.mocked(resolvePermission).mockReturnValue({
        needs_prompt: true,
        description: "Read wants to access /etc/hosts",
        pattern: "Read(/etc/hosts)",
      });
      // requestPermission resolves with allow_once
      mockRuntime.runPromise.mockResolvedValue({ decision: "allow_once" });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/etc/hosts" });

      expect(result.behavior).toBe("allow");
      expect(managed.cachedPermissions.has("Read(/etc/hosts)")).toBe(true);
    });

    it("adds to cache and writes settings on allow_future decision", async () => {
      vi.mocked(resolvePermission).mockReturnValue({
        needs_prompt: true,
        description: "Read wants to access /etc/hosts",
        pattern: "Read(/etc/hosts)",
      });
      mockRuntime.runPromise.mockResolvedValue({ decision: "allow_future" });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/etc/hosts" });

      expect(result.behavior).toBe("allow");
      expect(managed.cachedPermissions.has("Read(/etc/hosts)")).toBe(true);
      expect(appendToSettingsLocal).toHaveBeenCalledWith(
        managed.worktreePath,
        "Read(/etc/hosts)"
      );
    });

    it("denies tool when user decision is deny", async () => {
      vi.mocked(resolvePermission).mockReturnValue({
        needs_prompt: true,
        description: "Read wants to access /etc/hosts",
        pattern: "Read(/etc/hosts)",
      });
      mockRuntime.runPromise.mockResolvedValue({ decision: "deny", feedback: "Not allowed" });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/etc/hosts" });

      expect(result.behavior).toBe("deny");
      expect((result as { behavior: "deny"; message: string }).message).toBe("Not allowed");
    });

    it("denies when user decision is deny with no feedback", async () => {
      vi.mocked(resolvePermission).mockReturnValue({
        needs_prompt: true,
        description: "needs approval",
        pattern: "Read(/x)",
      });
      mockRuntime.runPromise.mockResolvedValue({ decision: "deny" });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/x" });

      expect(result.behavior).toBe("deny");
      expect((result as { behavior: "deny"; message: string }).message).toBe(
        "User denied this tool call."
      );
    });

    it("skips permission resolution for AskUserQuestion and proceeds to handler", async () => {
      // AskUserQuestion goes directly to handleAskUserQuestion which calls requestUserAnswer
      mockRuntime.runPromise.mockResolvedValue({ q1: "answer1" });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("AskUserQuestion", { questions: [] });

      expect(resolvePermission).not.toHaveBeenCalled();
      expect(result.behavior).toBe("allow");
    });

    it("skips permission resolution for ExitPlanMode", async () => {
      // ExitPlanMode goes directly to handleExitPlanMode
      mockRuntime.runPromise.mockResolvedValue({ approved: true });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      await handler("ExitPlanMode", {});

      expect(resolvePermission).not.toHaveBeenCalled();
    });
  });

  describe("when no worktreePath set", () => {
    it("falls through to AskUserQuestion handler when no worktreePath", async () => {
      mockRuntime.runPromise.mockResolvedValue({ q: "a" });

      const managed = makeManaged({ worktreePath: undefined });
      const handler = createCanUseToolHandler(managed);

      const result = await handler("AskUserQuestion", { questions: [] });
      expect(result.behavior).toBe("allow");
    });

    it("allows other tools when no worktreePath", async () => {
      const managed = makeManaged({ worktreePath: undefined });
      const handler = createCanUseToolHandler(managed);

      const result = await handler("Read", { file_path: "/some/file.ts" });
      expect(result.behavior).toBe("allow");
    });
  });

  describe("AskUserQuestion handling", () => {
    it("returns answers from service", async () => {
      mockRuntime.runPromise.mockResolvedValue({ q1: "my answer" });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("AskUserQuestion", {
        questions: [{ question: "q1", header: "Q1", options: [], multiSelect: false }],
      });

      expect(result.behavior).toBe("allow");
      expect((result as { behavior: "allow"; updatedInput: Record<string, unknown> }).updatedInput.answers).toEqual({ q1: "my answer" });
    });

    it("updates pending_questions in DB when sessionDbId is available", async () => {
      const { db, stmt } = makeMockDb();
      vi.mocked(getDatabase).mockReturnValue(db);
      vi.mocked(getSessionDbId).mockReturnValue(42);
      stmt.get.mockReturnValue({ feature_id: 1 });
      mockRuntime.runPromise.mockResolvedValue({});

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      await handler("AskUserQuestion", { questions: [] });

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("pending_questions")
      );
    });

    it("returns empty answers when service rejects (timeout)", async () => {
      mockRuntime.runPromise.mockRejectedValue(new Error("QuestionTimeout"));

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("AskUserQuestion", {});

      expect(result.behavior).toBe("allow");
      expect(
        (result as { behavior: "allow"; updatedInput: Record<string, unknown> }).updatedInput.answers
      ).toEqual({});
    });
  });

  describe("ExitPlanMode handling", () => {
    it("sets permission mode to acceptEdits when approved", async () => {
      const mockQuery = { setPermissionMode: vi.fn().mockResolvedValue(undefined) };
      mockRuntime.runPromise.mockResolvedValue({ approved: true });

      const managed = makeManaged({ query: mockQuery as unknown as ManagedSubprocess["query"] });
      const handler = createCanUseToolHandler(managed);

      const result = await handler("ExitPlanMode", {});

      expect(result.behavior).toBe("allow");
      expect(mockQuery.setPermissionMode).toHaveBeenCalledWith("acceptEdits");
    });

    it("denies when plan approval is rejected", async () => {
      mockRuntime.runPromise.mockResolvedValue({
        approved: false,
        feedback: "Please revise the plan",
      });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("ExitPlanMode", {});

      expect(result.behavior).toBe("deny");
      expect((result as { behavior: "deny"; message: string }).message).toBe(
        "Please revise the plan"
      );
    });

    it("denies when plan approval times out", async () => {
      mockRuntime.runPromise.mockRejectedValue(new Error("ApprovalTimeout"));

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      const result = await handler("ExitPlanMode", {});
      expect(result.behavior).toBe("deny");
    });
  });
});

// ---------------------------------------------------------------------------
// submitToolPermission
// ---------------------------------------------------------------------------

describe("submitToolPermission", () => {
  it("calls runtime.runSync to submit permission via service", () => {
    mockRuntime.runSync.mockReturnValue(undefined);

    submitToolPermission("sub-1", "allow_once");

    expect(mockRuntime.runSync).toHaveBeenCalled();
  });

  it("passes feedback to service for deny decision", () => {
    mockRuntime.runSync.mockReturnValue(undefined);

    submitToolPermission("sub-3", "deny", "No access allowed");

    expect(mockRuntime.runSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// submitUserAnswers
// ---------------------------------------------------------------------------

describe("submitUserAnswers", () => {
  it("calls runtime.runSync to submit answer via service", () => {
    mockRuntime.runSync.mockReturnValue(undefined);

    submitUserAnswers("sub-answers-1", { question1: "answer1" });

    expect(mockRuntime.runSync).toHaveBeenCalled();
  });

  it("persists answers to DB when session exists", () => {
    const { db, stmt } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(10);
    stmt.get.mockReturnValue({ feature_id: 5 });
    mockRuntime.runSync.mockReturnValue(undefined);

    submitUserAnswers("sub-persist", { q: "a" });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_messages")
    );
  });

  it("still submits via service even when DB persistence fails", () => {
    vi.mocked(getSessionDbId).mockReturnValue(10);
    vi.mocked(getDatabase).mockImplementation(() => { throw new Error("DB error"); });
    mockRuntime.runSync.mockReturnValue(undefined);

    // Should not throw
    expect(() => submitUserAnswers("sub-db-fail", { q: "a" })).not.toThrow();
    expect(mockRuntime.runSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// submitPlanApproval
// ---------------------------------------------------------------------------

describe("submitPlanApproval", () => {
  it("returns success when deferred was resolved (hadDeferred=true)", () => {
    mockRuntime.runSync.mockReturnValue(true);

    const result = submitPlanApproval("sub-plan-1", true);

    expect(result.success).toBe(true);
    expect(mockRuntime.runSync).toHaveBeenCalled();
  });

  it("stores in DB when no deferred pending (hadDeferred=false)", () => {
    const { db, stmt } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(55);
    stmt.get.mockReturnValue({ feature_id: 7 });
    mockRuntime.runSync.mockReturnValue(false);

    const result = submitPlanApproval("dead-subprocess", true);

    expect(result.success).toBe(true);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_sessions SET plan_approval_result"),
    );
  });

  it("persists feedback as user message when rejecting with active deferred", () => {
    const { db, stmt } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(20);
    stmt.get.mockReturnValue({ feature_id: 3 });
    mockRuntime.runSync.mockReturnValue(true); // deferred was resolved

    const result = submitPlanApproval("sub-plan-3", false, "Change the approach");

    expect(result.success).toBe(true);
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_messages")
    );
  });

  it("does not write to DB when approving with active deferred (no feedback)", () => {
    const { db } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(20);
    mockRuntime.runSync.mockReturnValue(true); // deferred was resolved

    const result = submitPlanApproval("sub-plan-4", true);

    expect(result.success).toBe(true);
    // DB should not be called for approval (no feedback to persist)
    expect(db.prepare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requestUserAnswers
// ---------------------------------------------------------------------------

describe("requestUserAnswers", () => {
  it("delegates to runtime.runPromise and returns answers", async () => {
    mockRuntime.runPromise.mockResolvedValue({ q: "my answer" });

    const answers = await requestUserAnswers("sub-req-1", { questions: [] });

    expect(answers.q).toBe("my answer");
    expect(mockRuntime.runPromise).toHaveBeenCalled();
  });
});
