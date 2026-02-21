/**
 * Tests for plan-approval.ts — waitForPlanApproval IPC wait logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for variables needed inside vi.mock factories
const { mockQuestionEmitter } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events");
  const mockQuestionEmitter = new EventEmitter();
  return { mockQuestionEmitter };
});

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

vi.mock("./session-persistence", () => ({
  getSessionDbId: vi.fn().mockReturnValue(10),
  notifyDbUpdated: vi.fn(),
}));

vi.mock("./tool-permissions", () => ({
  questionEmitter: mockQuestionEmitter,
}));

import { waitForPlanApproval } from "./plan-approval";
import * as sessionPersistence from "./session-persistence";
import { getDatabase } from "../db/database";

describe("waitForPlanApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuestionEmitter.removeAllListeners();

    (sessionPersistence.getSessionDbId as any).mockReturnValue(10);

    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ feature_id: 5 }),
        run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }),
        all: vi.fn().mockReturnValue([]),
      }),
    });
  });

  it("resolves with approved=true when user approves", async () => {
    const promise = waitForPlanApproval("proc-1", "## Plan\n\nStep 1");

    process.nextTick(() => {
      mockQuestionEmitter.emit("plan-approval:proc-1", { approved: true });
    });

    const result = await promise;
    expect(result.approved).toBe(true);
  });

  it("resolves with approved=false and feedback when user rejects", async () => {
    const promise = waitForPlanApproval("proc-2", "## Plan\n\nStep 1");

    process.nextTick(() => {
      mockQuestionEmitter.emit("plan-approval:proc-2", {
        approved: false,
        feedback: "Needs more detail",
      });
    });

    const result = await promise;
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

    const promise = waitForPlanApproval("proc-3", "## Plan");

    process.nextTick(() => {
      mockQuestionEmitter.emit("plan-approval:proc-3", { approved: true });
    });

    await promise;

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

    const promise = waitForPlanApproval("proc-4", "## Plan");

    process.nextTick(() => {
      mockQuestionEmitter.emit("plan-approval:proc-4", { approved: true });
    });

    await promise;

    const prepareCalls = mockPrepare.mock.calls.map((c: any) => c[0] as string);
    const clearCalls = prepareCalls.filter((q: string) =>
      q.includes("pending_plan_approval") && q.includes("NULL"),
    );
    expect(clearCalls.length).toBeGreaterThan(0);
  });

  it("works when no session exists for subprocess", async () => {
    (sessionPersistence.getSessionDbId as any).mockReturnValue(undefined);

    const promise = waitForPlanApproval("proc-no-session", "## Plan");

    process.nextTick(() => {
      mockQuestionEmitter.emit("plan-approval:proc-no-session", { approved: true });
    });

    const result = await promise;
    expect(result.approved).toBe(true);
  });
});
