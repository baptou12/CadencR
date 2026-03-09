/**
 * Tests for plan-approval.ts — waitForPlanApproval IPC wait logic.
 *
 * After the ToolPermissions Effect service migration, these tests mock
 * getAppRuntime() instead of the questionEmitter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ feature_id: 5 }),
      run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }),
      all: vi.fn().mockReturnValue([]),
    }),
  })),
}));

vi.mock("./broadcast", () => ({
  broadcast: vi.fn(),
  DB_UPDATED_CHANNEL: "db:updated",
}));

vi.mock("./effect-helpers", () => ({
  getSessionDbId: vi.fn().mockReturnValue(10),
  notifyDbUpdated: vi.fn(),
}));

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

import { waitForPlanApproval } from "./plan-approval";
import * as sessionPersistence from "./effect-helpers";
import { getDatabase } from "../db/database";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitForPlanApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (sessionPersistence.getSessionDbId as any).mockReturnValue(10);

    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ feature_id: 5 }),
        run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }),
        all: vi.fn().mockReturnValue([]),
      }),
    });

    // Default: no stored approval result, wait resolves with approved
    mockRuntime.runPromise.mockResolvedValue({ approved: true });
  });

  it("resolves with approved=true when service resolves", async () => {
    mockRuntime.runPromise.mockResolvedValue({ approved: true });

    const result = await waitForPlanApproval("proc-1", "## Plan\n\nStep 1");

    expect(result.approved).toBe(true);
  });

  it("resolves with approved=false and feedback when service rejects plan", async () => {
    mockRuntime.runPromise.mockResolvedValue({
      approved: false,
      feedback: "Needs more detail",
    });

    const result = await waitForPlanApproval("proc-2", "## Plan\n\nStep 1");

    expect(result.approved).toBe(false);
    expect(result.feedback).toBe("Needs more detail");
  });

  it("sets pending_plan_approval in DB before waiting", async () => {
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ feature_id: 5 }),
      run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }),
      all: vi.fn().mockReturnValue([]),
    });
    (getDatabase as any).mockReturnValue({ prepare: mockPrepare });
    mockRuntime.runPromise.mockResolvedValue({ approved: true });

    await waitForPlanApproval("proc-3", "## Plan");

    const prepareCalls = mockPrepare.mock.calls.map((c: any) => c[0] as string);
    expect(prepareCalls.some((q: string) => q.includes("pending_plan_approval"))).toBe(true);
  });

  it("clears pending_plan_approval after resolving", async () => {
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ feature_id: 5 }),
      run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }),
      all: vi.fn().mockReturnValue([]),
    });
    (getDatabase as any).mockReturnValue({ prepare: mockPrepare });
    mockRuntime.runPromise.mockResolvedValue({ approved: true });

    await waitForPlanApproval("proc-4", "## Plan");

    const prepareCalls = mockPrepare.mock.calls.map((c: any) => c[0] as string);
    const clearCalls = prepareCalls.filter((q: string) =>
      q.includes("pending_plan_approval") && q.includes("NULL"),
    );
    expect(clearCalls.length).toBeGreaterThan(0);
  });

  it("returns stored approval result immediately without waiting for service", async () => {
    const mockPrepare = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("plan_approval_result") && sql.includes("SELECT")) {
        return { get: () => ({ plan_approval_result: JSON.stringify({ approved: true, feedback: undefined }) }) };
      }
      if (sql.includes("UPDATE")) {
        return { run: vi.fn() };
      }
      if (sql.includes("feature_id")) {
        return { get: () => ({ feature_id: 5 }) };
      }
      return { get: vi.fn(), run: vi.fn(), all: vi.fn().mockReturnValue([]) };
    });
    (getDatabase as any).mockReturnValue({ prepare: mockPrepare });

    const result = await waitForPlanApproval("proc-stored", "## Plan");

    // Should return immediately without calling runPromise
    expect(result.approved).toBe(true);
    expect(mockRuntime.runPromise).not.toHaveBeenCalled();
  });

  it("does not check stored result when no session exists", async () => {
    (sessionPersistence.getSessionDbId as any).mockReturnValue(undefined);
    mockRuntime.runPromise.mockResolvedValue({ approved: true });

    const result = await waitForPlanApproval("proc-no-stored", "## Plan");

    expect(result.approved).toBe(true);
  });

  it("works when no session exists for subprocess", async () => {
    (sessionPersistence.getSessionDbId as any).mockReturnValue(undefined);
    mockRuntime.runPromise.mockResolvedValue({ approved: true });

    const result = await waitForPlanApproval("proc-no-session", "## Plan");

    expect(result.approved).toBe(true);
  });

  it("propagates error when service rejects (e.g. timeout)", async () => {
    mockRuntime.runPromise.mockRejectedValue(new Error("ApprovalTimeout"));

    await expect(waitForPlanApproval("proc-timeout", "## Plan")).rejects.toThrow("ApprovalTimeout");
  });
});
