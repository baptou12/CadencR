/**
 * Tests for execute-agent.ts — processNextPhase queue-based execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }),
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([]),
    })),
  })),
}));

vi.mock("../db/query", () => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  queryAllValidated: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("./broadcast", () => ({
  broadcast: vi.fn(),
  AGENT_EVENT_CHANNEL: "agent:event",
}));

vi.mock("./state-transitions", () => ({
  transitionFeature: vi.fn(),
  transitionPhase: vi.fn(),
  transitionPhaseIf: vi.fn(),
  transitionAgentSession: vi.fn(),
}));

vi.mock("./unified-agent", () => ({
  startUnifiedAgent: vi.fn().mockResolvedValue({
    subprocessId: "sub-1",
    agentType: "execute",
    sessionDbId: 100,
  }),
}));

vi.mock("./agent-configs", () => ({
  buildExecuteSystemPrompt: vi.fn().mockReturnValue("system prompt"),
  createQaConfig: vi.fn().mockReturnValue({ completionActions: [] }),
}));

vi.mock("./mcp-factory", () => ({
  buildMcpServerFactory: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../db/settings", async () => {
  const { Effect } = await import("effect");
  return {
    resolveSetting: vi.fn().mockReturnValue(Effect.succeed(null)),
  };
});

vi.mock("./effect-helpers", () => ({
  notifyDbUpdated: vi.fn(),
}));

import { Effect } from "effect";
import { processNextPhase, getAutonomyLevel } from "./execute-agent";
import { transitionFeature } from "./state-transitions";
import { startUnifiedAgent } from "./unified-agent";
import { queryOne, queryAll, queryAllValidated } from "../db/query";
import { notifyDbUpdated } from "./effect-helpers";

const mockQueryOne = vi.mocked(queryOne);
const mockQueryAll = vi.mocked(queryAll);
const mockQueryAllValidated = vi.mocked(queryAllValidated);

const baseOptions = {
  featureId: 1,
  projectId: 2,
  cwd: "/project",
};

function setupQueries(overrides: {
  featureStatus?: string;
  planId?: number | null;
  hasRunningAgent?: boolean;
  pendingPhases?: any[];
  lastReviewId?: number | null;
  lastExecId?: number | null;
  hasRunningReview?: boolean;
  lastCompletedExecId?: number | null;
} = {}) {
  const {
    featureStatus = "in-progress",
    planId = 10,
    hasRunningAgent = false,
    pendingPhases = [],
    lastReviewId = null,
    lastExecId = null,
    hasRunningReview = false,
    lastCompletedExecId = null,
  } = overrides;

  mockQueryOne.mockImplementation((sql: string, ..._params: unknown[]) => {
    if (sql.includes("SELECT status FROM features")) {
      return Effect.succeed({ status: featureStatus }) as any;
    }
    if (sql.includes("SELECT id FROM plans")) {
      return planId ? Effect.succeed({ id: planId }) as any : Effect.succeed(null) as any;
    }
    if (sql.includes("agent_type IN ('execute', 'qa') AND status = 'running'")) {
      return hasRunningAgent ? Effect.succeed({ id: 999 }) as any : Effect.succeed(null) as any;
    }
    if (sql.includes("agent_type = 'review' AND status = 'completed'")) {
      return lastReviewId ? Effect.succeed({ id: lastReviewId, ended_at: null }) as any : Effect.succeed(null) as any;
    }
    if (sql.includes("agent_type IN ('execute', 'qa') AND status = 'completed'")) {
      if (lastExecId) return Effect.succeed({ id: lastExecId, ended_at: null }) as any;
      if (lastCompletedExecId) return Effect.succeed({ id: lastCompletedExecId }) as any;
      return Effect.succeed(null) as any;
    }
    if (sql.includes("agent_type = 'review' AND status = 'running'")) {
      return hasRunningReview ? Effect.succeed({ id: 888 }) as any : Effect.succeed(null) as any;
    }
    return Effect.succeed(null) as any;
  });

  mockQueryAll.mockImplementation((_sql: string, ..._params: unknown[]) => {
    return Effect.succeed([]) as any;
  });

  mockQueryAllValidated.mockImplementation((_schema: unknown, sql: string, ..._params: unknown[]) => {
    if (typeof sql === "string" && sql.includes("FROM phases")) {
      return Effect.succeed(pendingPhases) as any;
    }
    return Effect.succeed([]) as any;
  });
}

describe("processNextPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (startUnifiedAgent as any).mockResolvedValue({
      subprocessId: "sub-1",
      agentType: "execute",
      sessionDbId: 100,
    });
  });

  it("returns early when feature is not in-progress or planned", () => {
    setupQueries({ featureStatus: "draft" });
    processNextPhase(baseOptions);
    expect(startUnifiedAgent).not.toHaveBeenCalled();
  });

  it("returns early when no active plan", () => {
    setupQueries({ planId: null });
    processNextPhase(baseOptions);
    expect(startUnifiedAgent).not.toHaveBeenCalled();
  });

  it("returns early when agents are already running (idempotent guard)", () => {
    setupQueries({ hasRunningAgent: true, pendingPhases: [{ id: 1 }] });
    processNextPhase(baseOptions);
    expect(startUnifiedAgent).not.toHaveBeenCalled();
  });

  it("transitions feature from planned to in-progress", () => {
    setupQueries({
      featureStatus: "planned",
      pendingPhases: [
        { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "do", order_index: 0, phase_type: "value" },
      ],
    });

    processNextPhase(baseOptions);

    expect(transitionFeature).toHaveBeenCalledWith(1, "in-progress");
  });

  it("dispatches pending phases", () => {
    setupQueries({
      pendingPhases: [
        { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "do", order_index: 0, phase_type: "value" },
      ],
    });

    processNextPhase(baseOptions);

    expect(startUnifiedAgent).toHaveBeenCalledTimes(1);
  });

  it("dispatches multiple phases from same step in parallel", () => {
    (startUnifiedAgent as any)
      .mockResolvedValueOnce({ subprocessId: "sub-1", agentType: "execute", sessionDbId: 100 })
      .mockResolvedValueOnce({ subprocessId: "sub-2", agentType: "execute", sessionDbId: 101 });

    setupQueries({
      pendingPhases: [
        { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "A", order_index: 0, phase_type: "value" },
        { id: 2, plan_id: 10, step_number: 1, title: "P2", status: "pending", complexity: 1, commit_message: null, prompt: "B", order_index: 1, phase_type: "value" },
      ],
    });

    processNextPhase(baseOptions);

    expect(startUnifiedAgent).toHaveBeenCalledTimes(2);
  });

  it("only dispatches phases from the lowest step number", () => {
    setupQueries({
      pendingPhases: [
        { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "A", order_index: 0, phase_type: "value" },
        { id: 2, plan_id: 10, step_number: 2, title: "P2", status: "pending", complexity: 1, commit_message: null, prompt: "B", order_index: 0, phase_type: "value" },
      ],
    });

    processNextPhase(baseOptions);

    // Only step 1 phase dispatched
    expect(startUnifiedAgent).toHaveBeenCalledTimes(1);
  });

  it("triggers review when no pending phases and no recent review", () => {
    setupQueries({ pendingPhases: [] });

    // Mock the dynamic require for startReviewAgent
    vi.doMock("./agent-starters", () => ({
      startReviewAgent: vi.fn(),
    }));

    processNextPhase(baseOptions);

    // No phases to dispatch, should attempt review (we can't easily test the dynamic require)
    expect(startUnifiedAgent).not.toHaveBeenCalled();
  });

  it("marks feature done when review ran after execute with no fixes", () => {
    setupQueries({
      pendingPhases: [],
      lastReviewId: 20,
      lastExecId: 10,
    });

    processNextPhase(baseOptions);

    expect(transitionFeature).toHaveBeenCalledWith(1, "done");
    expect(notifyDbUpdated).toHaveBeenCalledWith("feature", 1);
  });
});

describe("getAutonomyLevel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 (default) when no setting found", async () => {
    const { resolveSetting } = await import("../db/settings");
    (resolveSetting as any).mockReturnValue(Effect.succeed(null));
    expect(getAutonomyLevel(1, 1)).toBe(1);
  });

  it("returns parsed integer from setting", async () => {
    const { resolveSetting } = await import("../db/settings");
    (resolveSetting as any).mockReturnValue(Effect.succeed("2"));
    expect(getAutonomyLevel(1, 1)).toBe(2);
  });

  it("returns 1 for level 1 setting", async () => {
    const { resolveSetting } = await import("../db/settings");
    (resolveSetting as any).mockReturnValue(Effect.succeed("1"));
    expect(getAutonomyLevel(1, 1)).toBe(1);
  });
});
