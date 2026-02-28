import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn(),
  tool: vi.fn(),
}));
vi.mock("../db/database");
vi.mock("./session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));
vi.mock("./state-transitions", () => ({
  transitionFeature: vi.fn(),
}));
vi.mock("../db/settings", () => ({
  resolveSetting: vi.fn().mockReturnValue("1"),
}));
vi.mock("./resolve-cwd", () => ({
  resolveAgentCwd: vi.fn().mockReturnValue({ cwd: "/project", worktreePath: undefined }),
}));

import { initWorkflow, onStepCompleted, advanceWorkflow, continueWorkflow, autoStartExecuteAfterQa, resumeWorkflows } from "./workflow-orchestrator";
import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./session-persistence";
import { transitionFeature } from "./state-transitions";
import { resolveSetting } from "../db/settings";
import { createMockDb } from "../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);
const mockTransitionFeature = vi.mocked(transitionFeature);
const mockResolveSetting = vi.mocked(resolveSetting);

function makeMockDb(overrides: Record<string, (sql: string) => any> = {}) {
  const db = createMockDb();
  db.prepare.mockImplementation((sql: string) => {
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (sql.includes(pattern)) return handler(sql);
    }
    return { run: vi.fn(), get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) };
  });
  mockGetDatabase.mockReturnValue(db as any);
  return db;
}

describe("initWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets workflow_step to prd with empty config", () => {
    const runFn = vi.fn();
    makeMockDb({
      "UPDATE features SET workflow_step": () => ({ run: runFn }),
    });

    initWorkflow(1, "prd");
    expect(runFn).toHaveBeenCalledWith("prd", "{}", 1);
  });

  it("sets workflow_step to plan with empty config", () => {
    const runFn = vi.fn();
    makeMockDb({
      "UPDATE features SET workflow_step": () => ({ run: runFn }),
    });

    initWorkflow(5, "plan");
    expect(runFn).toHaveBeenCalledWith("plan", "{}", 5);
  });
});

describe("onStepCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to autonomy 1 so runStep() doesn't fire (avoids dynamic require issues)
    mockResolveSetting.mockReturnValue("1");
  });

  it("returns early when feature has no workflow_step", () => {
    makeMockDb({
      "SELECT workflow_step, project_id": () => ({ get: vi.fn().mockReturnValue(null) }),
    });
    onStepCompleted(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns early when workflow_step is null", () => {
    makeMockDb({
      "SELECT workflow_step, project_id": () => ({ get: vi.fn().mockReturnValue({ workflow_step: null, project_id: 1 }) }),
    });
    onStepCompleted(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns early when step is done", () => {
    makeMockDb({
      "SELECT workflow_step, project_id": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "done", project_id: 1 }) }),
    });
    onStepCompleted(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("prd → plan", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "prd", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("plan", 1);
    expect(mockNotify).toHaveBeenCalledWith("feature", 1);
  });

  it("plan → execute", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "plan", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("execute", 1);
  });

  it("execute → qa (always)", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "execute", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 5 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    // execute always goes to qa regardless of pending fixes
    expect(updateRun).toHaveBeenCalledWith("qa", 1);
  });

  it("qa → execute when pending fixes exist (loop)", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "qa", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 3 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("execute", 1);
  });

  it("qa → review when no pending fixes", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "qa", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("review", 1);
  });

  it("qa → review when no active plan (no pending fixes possible)", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "qa", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("review", 1);
  });

  it("review → execute when pending fixes exist (loop)", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "review", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 2 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("execute", 1);
  });

  it("review → done when no pending fixes (clears workflow)", () => {
    const clearRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "review", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = NULL": () => ({ run: clearRun }),
    });

    onStepCompleted(1);
    expect(clearRun).toHaveBeenCalledWith(1);
    expect(mockTransitionFeature).toHaveBeenCalledWith(expect.anything(), 1, "done");
    expect(mockNotify).toHaveBeenCalledWith("feature", 1);
  });

  it("does not auto-run step when autonomy < 2", () => {
    mockResolveSetting.mockReturnValue("1");
    const updateRun = vi.fn();
    const db = makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "prd", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("plan", 1);
    // runStep should NOT have been called — we can verify by checking
    // that no workflow_step FROM features query happened after the update
    // (runStep queries workflow_step again internally)
    const prepareCalls = db.prepare.mock.calls.map(c => c[0] as string);
    const workflowStepQueries = prepareCalls.filter(s => s.includes("SELECT workflow_step FROM features"));
    expect(workflowStepQueries.length).toBe(0);
  });
});

describe("advanceWorkflow alias", () => {
  it("is the same function as onStepCompleted", () => {
    expect(advanceWorkflow).toBe(onStepCompleted);
  });
});

describe("continueWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns early when feature has no workflow_step", () => {
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue(null) }),
    });
    continueWorkflow(1);
    // No runStep call — verified by no further DB queries
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns early when workflow_step is null", () => {
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: null, project_id: 1 }) }),
    });
    continueWorkflow(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("autoStartExecuteAfterQa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSetting.mockReturnValue("1");
  });

  it("does nothing when no active plan", () => {
    makeMockDb({
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
    });
    autoStartExecuteAfterQa(1, 2);
    // No further DB queries after plan not found
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does nothing when no pending phases", () => {
    makeMockDb({
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
    });
    autoStartExecuteAfterQa(1, 2);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does nothing when autonomy < 2", () => {
    mockResolveSetting.mockReturnValue("1");
    const db = makeMockDb({
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 2 }) }),
    });
    autoStartExecuteAfterQa(1, 2);
    // Should not try to resolve cwd (which would happen before starting execute)
    const prepareCalls = db.prepare.mock.calls.map(c => c[0] as string);
    expect(prepareCalls.some(s => s.includes("worktree"))).toBe(false);
  });
});

describe("resumeWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSetting.mockReturnValue("1");
  });

  it("does nothing when no active workflows", () => {
    makeMockDb({
      "SELECT id, project_id, workflow_step FROM features": () => ({ all: vi.fn().mockReturnValue([]) }),
    });
    resumeWorkflows();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("advances workflow when session is completed", () => {
    const updateRun = vi.fn();
    makeMockDb({
      "SELECT id, project_id, workflow_step FROM features WHERE workflow_step": () => ({
        all: vi.fn().mockReturnValue([{ id: 1, project_id: 2, workflow_step: "plan" }]),
      }),
      "SELECT id, status FROM agent_sessions": () => ({
        get: vi.fn().mockReturnValue({ id: 5, status: "completed" }),
      }),
      // onStepCompleted will query these:
      "SELECT workflow_step, project_id FROM features": () => ({
        get: vi.fn().mockReturnValue({ workflow_step: "plan", project_id: 2 }),
      }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    resumeWorkflows();
    expect(updateRun).toHaveBeenCalledWith("execute", 1);
  });

  it("does not advance when session is still running", () => {
    makeMockDb({
      "SELECT id, project_id, workflow_step FROM features WHERE workflow_step": () => ({
        all: vi.fn().mockReturnValue([{ id: 1, project_id: 2, workflow_step: "execute" }]),
      }),
      "SELECT id, status FROM agent_sessions": () => ({
        get: vi.fn().mockReturnValue({ id: 5, status: "running" }),
      }),
    });

    resumeWorkflows();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not advance when session is paused", () => {
    makeMockDb({
      "SELECT id, project_id, workflow_step FROM features WHERE workflow_step": () => ({
        all: vi.fn().mockReturnValue([{ id: 1, project_id: 2, workflow_step: "qa" }]),
      }),
      "SELECT id, status FROM agent_sessions": () => ({
        get: vi.fn().mockReturnValue({ id: 5, status: "paused" }),
      }),
    });

    resumeWorkflows();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not advance when no session exists", () => {
    makeMockDb({
      "SELECT id, project_id, workflow_step FROM features WHERE workflow_step": () => ({
        all: vi.fn().mockReturnValue([{ id: 1, project_id: 2, workflow_step: "prd" }]),
      }),
      "SELECT id, status FROM agent_sessions": () => ({
        get: vi.fn().mockReturnValue(null),
      }),
    });

    resumeWorkflows();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("handles multiple features with mixed states", () => {
    const updateRun = vi.fn();
    let sessionCallCount = 0;
    makeMockDb({
      "SELECT id, project_id, workflow_step FROM features WHERE workflow_step": () => ({
        all: vi.fn().mockReturnValue([
          { id: 1, project_id: 2, workflow_step: "prd" },
          { id: 2, project_id: 3, workflow_step: "execute" },
        ]),
      }),
      "SELECT id, status FROM agent_sessions": () => ({
        get: vi.fn().mockImplementation(() => {
          sessionCallCount++;
          // First feature: completed, second: running
          return sessionCallCount === 1
            ? { id: 5, status: "completed" }
            : { id: 6, status: "running" };
        }),
      }),
      "SELECT workflow_step, project_id FROM features": () => ({
        get: vi.fn().mockReturnValue({ workflow_step: "prd", project_id: 2 }),
      }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    resumeWorkflows();
    // Only the first feature (completed session) should advance
    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(updateRun).toHaveBeenCalledWith("plan", 1);
  });
});

describe("transition table completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSetting.mockReturnValue("1");
  });

  it("execute always transitions to qa regardless of pending fixes", () => {
    const updateRun = vi.fn();
    // Even with no pending fixes, execute → qa
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "execute", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
    });

    onStepCompleted(1);
    expect(updateRun).toHaveBeenCalledWith("qa", 1);
  });

  it("full workflow: prd → plan → execute → qa → review → done (no fixes)", () => {
    // Simulate the full chain by calling onStepCompleted for each step
    const steps = ["prd", "plan", "execute", "qa", "review"];
    const transitions: string[] = [];

    for (const step of steps) {
      const updateRun = vi.fn();
      const clearRun = vi.fn();
      makeMockDb({
        "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: step, project_id: 1 }) }),
        "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
        "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
        "UPDATE features SET workflow_step = ?": () => ({ run: updateRun }),
        "UPDATE features SET workflow_step = NULL": () => ({ run: clearRun }),
      });

      onStepCompleted(1);

      if (clearRun.mock.calls.length > 0) {
        transitions.push("done");
      } else if (updateRun.mock.calls.length > 0) {
        transitions.push(updateRun.mock.calls[0][0]);
      }
    }

    expect(transitions).toEqual(["plan", "execute", "qa", "review", "done"]);
  });

  it("qa → execute → qa loop with fixes then review", () => {
    // First QA: has pending fixes → execute
    const updateRun1 = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "qa", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 2 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun1 }),
    });
    onStepCompleted(1);
    expect(updateRun1).toHaveBeenCalledWith("execute", 1);

    // Execute completes → qa
    const updateRun2 = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "execute", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun2 }),
    });
    onStepCompleted(1);
    expect(updateRun2).toHaveBeenCalledWith("qa", 1);

    // Second QA: no fixes → review
    const updateRun3 = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "qa", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun3 }),
    });
    onStepCompleted(1);
    expect(updateRun3).toHaveBeenCalledWith("review", 1);
  });

  it("review → execute → qa → review loop with fixes then done", () => {
    // Review with fixes → execute
    const updateRun1 = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "review", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 1 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun1 }),
    });
    onStepCompleted(1);
    expect(updateRun1).toHaveBeenCalledWith("execute", 1);

    // Execute → qa
    const updateRun2 = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "execute", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue(null) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun2 }),
    });
    onStepCompleted(1);
    expect(updateRun2).toHaveBeenCalledWith("qa", 1);

    // QA no fixes → review
    const updateRun3 = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "qa", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = ?": () => ({ run: updateRun3 }),
    });
    onStepCompleted(1);
    expect(updateRun3).toHaveBeenCalledWith("review", 1);

    // Review no fixes → done
    const clearRun = vi.fn();
    makeMockDb({
      "SELECT workflow_step, project_id FROM features": () => ({ get: vi.fn().mockReturnValue({ workflow_step: "review", project_id: 1 }) }),
      "SELECT id FROM plans": () => ({ get: vi.fn().mockReturnValue({ id: 10 }) }),
      "SELECT COUNT(*) as cnt FROM phases": () => ({ get: vi.fn().mockReturnValue({ cnt: 0 }) }),
      "UPDATE features SET workflow_step = NULL": () => ({ run: clearRun }),
    });
    onStepCompleted(1);
    expect(clearRun).toHaveBeenCalledWith(1);
    expect(mockTransitionFeature).toHaveBeenCalledWith(expect.anything(), 1, "done");
  });
});
