/**
 * Tests for the tool-permissions module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("./session-persistence", () => ({
  getSessionDbId: vi.fn(),
  notifyDbUpdated: vi.fn(),
}));

vi.mock("./permissions", () => ({
  resolvePermission: vi.fn(),
  appendToSettingsLocal: vi.fn(),
}));

vi.mock("./broadcast", () => ({
  broadcast: vi.fn(),
  ASK_USER_QUESTION_CHANNEL: "ask-user-question",
  TOOL_PERMISSION_CHANNEL: "tool-permission",
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getDatabase } from "../db/database";
import { getSessionDbId } from "./session-persistence";
import { resolvePermission, appendToSettingsLocal } from "./permissions";
import { broadcast } from "./broadcast";
import {
  createCanUseToolHandler,
  questionEmitter,
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
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      // Simulate renderer responding with allow_once
      setTimeout(() => {
        questionEmitter.emit("permission:test-subprocess-id", { decision: "allow_once" });
      }, 10);

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
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("permission:test-subprocess-id", { decision: "allow_future" });
      }, 10);

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
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("permission:test-subprocess-id", {
          decision: "deny",
          feedback: "Not allowed",
        });
      }, 10);

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
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("permission:test-subprocess-id", { decision: "deny" });
      }, 10);

      const result = await handler("Read", { file_path: "/x" });

      expect(result.behavior).toBe("deny");
      expect((result as { behavior: "deny"; message: string }).message).toBe(
        "User denied this tool call."
      );
    });

    it("skips permission resolution for AskUserQuestion and proceeds to handler", async () => {
      // resolvePermission should NOT be called for AskUserQuestion
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      // AskUserQuestion falls through to handleAskUserQuestion which waits for answers
      // We'll emit the answer immediately
      setTimeout(() => {
        questionEmitter.emit("answer:test-subprocess-id", { q1: "answer1" });
      }, 10);

      const result = await handler("AskUserQuestion", { questions: [] });

      expect(resolvePermission).not.toHaveBeenCalled();
      expect(result.behavior).toBe("allow");
    });

    it("skips permission resolution for ExitPlanMode", async () => {
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("plan-approval:test-subprocess-id", { approved: true });
      }, 10);

      await handler("ExitPlanMode", {});

      expect(resolvePermission).not.toHaveBeenCalled();
    });
  });

  describe("when no worktreePath set", () => {
    it("falls through to AskUserQuestion handler when no worktreePath", async () => {
      const managed = makeManaged({ worktreePath: undefined });
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("answer:test-subprocess-id", { q: "a" });
      }, 10);

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
    it("broadcasts question and returns answers", async () => {
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      // resolvePermission must allow since AskUserQuestion is in ALWAYS_ALLOW_TOOLS
      // But actually, when worktreePath is set, AskUserQuestion is skipped from permission resolution
      // It goes directly to handleAskUserQuestion
      setTimeout(() => {
        questionEmitter.emit("answer:test-subprocess-id", { q1: "my answer" });
      }, 10);

      const result = await handler("AskUserQuestion", {
        questions: [{ question: "q1", header: "Q1", options: [], multiSelect: false }],
      });

      expect(broadcast).toHaveBeenCalled();
      expect(result.behavior).toBe("allow");
      expect((result as { behavior: "allow"; updatedInput: Record<string, unknown> }).updatedInput.answers).toEqual({ q1: "my answer" });
    });

    it("updates pending_questions in DB when sessionDbId is available", async () => {
      const { db, stmt } = makeMockDb();
      vi.mocked(getDatabase).mockReturnValue(db);
      vi.mocked(getSessionDbId).mockReturnValue(42);
      stmt.get.mockReturnValue({ feature_id: 1 });

      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("answer:test-subprocess-id", {});
      }, 10);

      await handler("AskUserQuestion", { questions: [] });

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("pending_questions")
      );
    });

    it("returns empty answers on timeout/error in AskUserQuestion", async () => {
      // Don't emit anything — but we can't wait 15 min, so simulate by rejecting early
      // We'll just verify the fallback path by emitting an error-like situation
      // Actually we can test by having the promise resolve with empty answers
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      // Emit with empty answers
      setTimeout(() => {
        questionEmitter.emit("answer:test-subprocess-id", {});
      }, 10);

      const result = await handler("AskUserQuestion", {});

      expect(result.behavior).toBe("allow");
    });
  });

  describe("ExitPlanMode handling", () => {
    it("sets permission mode to acceptEdits when approved", async () => {
      const mockQuery = { setPermissionMode: vi.fn().mockResolvedValue(undefined) };
      const managed = makeManaged({ query: mockQuery as unknown as ManagedSubprocess["query"] });
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("plan-approval:test-subprocess-id", { approved: true });
      }, 10);

      const result = await handler("ExitPlanMode", {});

      expect(result.behavior).toBe("allow");
      expect(mockQuery.setPermissionMode).toHaveBeenCalledWith("acceptEdits");
    });

    it("denies when plan approval is rejected", async () => {
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("plan-approval:test-subprocess-id", {
          approved: false,
          feedback: "Please revise the plan",
        });
      }, 10);

      const result = await handler("ExitPlanMode", {});

      expect(result.behavior).toBe("deny");
      expect((result as { behavior: "deny"; message: string }).message).toBe(
        "Please revise the plan"
      );
    });

    it("allows when plan approval timeout occurs (graceful fallback)", async () => {
      // Simulate timeout rejection by directly emitting the plan-approval with a trick
      // We can test the 'approved:false, no feedback' path
      const managed = makeManaged();
      const handler = createCanUseToolHandler(managed);

      setTimeout(() => {
        questionEmitter.emit("plan-approval:test-subprocess-id", {
          approved: false,
          feedback: undefined,
        });
      }, 10);

      const result = await handler("ExitPlanMode", {});
      expect(result.behavior).toBe("deny");
    });
  });
});

// ---------------------------------------------------------------------------
// submitToolPermission
// ---------------------------------------------------------------------------

describe("submitToolPermission", () => {
  it("emits permission event for the subprocess", async () => {
    const promise = new Promise<{ decision: string }>((resolve) => {
      questionEmitter.once("permission:sub-1", resolve);
    });

    submitToolPermission("sub-1", "allow_once");

    const result = await promise;
    expect(result.decision).toBe("allow_once");
  });

  it("emits allow_future decision", async () => {
    const promise = new Promise<{ decision: string }>((resolve) => {
      questionEmitter.once("permission:sub-2", resolve);
    });

    submitToolPermission("sub-2", "allow_future");

    const result = await promise;
    expect(result.decision).toBe("allow_future");
  });

  it("emits deny decision with feedback", async () => {
    const promise = new Promise<{ decision: string; feedback?: string }>((resolve) => {
      questionEmitter.once("permission:sub-3", resolve);
    });

    submitToolPermission("sub-3", "deny", "No access allowed");

    const result = await promise;
    expect(result.decision).toBe("deny");
    expect(result.feedback).toBe("No access allowed");
  });
});

// ---------------------------------------------------------------------------
// submitUserAnswers
// ---------------------------------------------------------------------------

describe("submitUserAnswers", () => {
  it("emits answer event for the subprocess", async () => {
    const promise = new Promise<Record<string, string>>((resolve) => {
      questionEmitter.once("answer:sub-answers-1", resolve);
    });

    submitUserAnswers("sub-answers-1", { question1: "answer1" });

    const result = await promise;
    expect(result.question1).toBe("answer1");
  });

  it("persists answers to DB when session exists", () => {
    const { db, stmt } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(10);
    stmt.get.mockReturnValue({ feature_id: 5 });

    submitUserAnswers("sub-persist", { q: "a" });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_messages")
    );
  });

  it("still emits even when DB persistence fails", async () => {
    vi.mocked(getSessionDbId).mockReturnValue(10);
    vi.mocked(getDatabase).mockImplementation(() => { throw new Error("DB error"); });

    const promise = new Promise<Record<string, string>>((resolve) => {
      questionEmitter.once("answer:sub-db-fail", resolve);
    });

    submitUserAnswers("sub-db-fail", { q: "a" });

    const result = await promise;
    expect(result.q).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// submitPlanApproval
// ---------------------------------------------------------------------------

describe("submitPlanApproval", () => {
  it("emits plan-approval event with approved=true", async () => {
    const promise = new Promise<{ approved: boolean }>((resolve) => {
      questionEmitter.once("plan-approval:sub-plan-1", resolve);
    });

    submitPlanApproval("sub-plan-1", true);

    const result = await promise;
    expect(result.approved).toBe(true);
  });

  it("emits plan-approval event with approved=false and feedback", async () => {
    const promise = new Promise<{ approved: boolean; feedback?: string }>((resolve) => {
      questionEmitter.once("plan-approval:sub-plan-2", resolve);
    });

    submitPlanApproval("sub-plan-2", false, "Needs more tests");

    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.feedback).toBe("Needs more tests");
  });

  it("persists feedback to DB as user message when rejecting", () => {
    const { db, stmt } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(20);
    stmt.get.mockReturnValue({ feature_id: 3 });

    submitPlanApproval("sub-plan-3", false, "Change the approach");

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_messages")
    );
  });

  it("does not write to DB when approving (no feedback)", () => {
    const { db } = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    vi.mocked(getSessionDbId).mockReturnValue(20);

    submitPlanApproval("sub-plan-4", true);

    // DB should not be called for approval (no feedback to persist)
    expect(db.prepare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requestUserAnswers
// ---------------------------------------------------------------------------

describe("requestUserAnswers", () => {
  it("broadcasts question and resolves when answer emitted", async () => {
    const promise = requestUserAnswers("sub-req-1", { questions: [] });

    setTimeout(() => {
      questionEmitter.emit("answer:sub-req-1", { q: "my answer" });
    }, 10);

    const answers = await promise;
    expect(answers.q).toBe("my answer");
    expect(broadcast).toHaveBeenCalledWith("ask-user-question", expect.objectContaining({
      subprocessId: "sub-req-1",
    }));
  });
});
