/**
 * Tests for execute-agent.ts — phase execution orchestration, step grouping, error handling.
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
  startUnifiedAgent: vi.fn().mockReturnValue({
    subprocessId: "sub-1",
    agentType: "execute",
    sessionDbId: 100,
  }),
}));

vi.mock("./agent-configs", () => ({
  buildExecuteSystemPrompt: vi.fn().mockReturnValue("system prompt"),
  createQaConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./mcp-tools", () => ({
  createExecuteMcpServer: vi.fn().mockReturnValue({}),
}));

vi.mock("../db/settings", () => ({
  resolveSetting: vi.fn().mockReturnValue(null),
}));

import { startExecuteAgent, getAutonomyLevel } from "./execute-agent";
import { transitionFeature } from "./state-transitions";
import { startUnifiedAgent } from "./unified-agent";
import { getDatabase } from "../db/database";

const baseOptions = {
  featureId: 1,
  projectId: 2,
  cwd: "/project",
};

function setupMockDb(phases: any[] = [], planId = 10) {
  (getDatabase as any).mockReturnValue({
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO agent_sessions")) {
        return { run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }) };
      }
      if (sql.includes("SELECT id FROM plans")) {
        return { get: vi.fn().mockReturnValue({ id: planId }) };
      }
      if (sql.includes("SELECT id, plan_id, step_number")) {
        return { all: vi.fn().mockReturnValue(phases) };
      }
      if (sql.includes("COUNT(*) as cnt FROM phases")) {
        return { get: vi.fn().mockReturnValue({ cnt: 0 }) };
      }
      return {
        run: vi.fn(),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      };
    }),
  });
}

describe("startExecuteAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (startUnifiedAgent as any).mockReturnValue({
      subprocessId: "sub-1",
      agentType: "execute",
      sessionDbId: 100,
    });
  });

  it("throws when no active plan exists", () => {
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("INSERT INTO agent_sessions")) {
          return { run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }) };
        }
        return { run: vi.fn(), get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) };
      }),
    });

    expect(() => startExecuteAgent(baseOptions)).toThrow("No active plan found");
  });

  it("throws when no pending phases exist", () => {
    setupMockDb([]);
    expect(() => startExecuteAgent(baseOptions)).toThrow("No pending phases");
  });

  it("transitions feature to in-progress on start", () => {
    setupMockDb([
      {
        id: 1, plan_id: 10, step_number: 1, title: "Phase 1", status: "pending",
        complexity: 2, commit_message: "feat: phase 1", prompt: "do something",
        order_index: 0, phase_type: "simplan:exec",
      },
    ]);

    startExecuteAgent(baseOptions);

    expect(transitionFeature).toHaveBeenCalledWith(expect.anything(), 1, "in-progress");
  });

  it("creates orchestrator session record", () => {
    const sessionRun = vi.fn().mockReturnValue({ lastInsertRowid: 77 });
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("INSERT INTO agent_sessions")) return { run: sessionRun };
        if (sql.includes("SELECT id FROM plans")) return { get: vi.fn().mockReturnValue({ id: 10 }) };
        if (sql.includes("SELECT id, plan_id, step_number")) return {
          all: vi.fn().mockReturnValue([
            { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending",
              complexity: 1, commit_message: null, prompt: "do", order_index: 0, phase_type: "simplan:exec" },
          ]),
        };
        return { run: vi.fn(), get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) };
      }),
    });

    const result = startExecuteAgent(baseOptions);

    expect(sessionRun).toHaveBeenCalledWith(1, "execute", "running");
    expect(result.sessionDbId).toBe(77);
  });

  it("returns subprocess IDs from first step phases", () => {
    (startUnifiedAgent as any)
      .mockReturnValueOnce({ subprocessId: "sub-1", agentType: "execute", sessionDbId: 100 })
      .mockReturnValueOnce({ subprocessId: "sub-2", agentType: "execute", sessionDbId: 101 });

    setupMockDb([
      { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "A", order_index: 0, phase_type: "simplan:exec" },
      { id: 2, plan_id: 10, step_number: 1, title: "P2", status: "pending", complexity: 1, commit_message: null, prompt: "B", order_index: 1, phase_type: "simplan:exec" },
    ]);

    const result = startExecuteAgent(baseOptions);
    expect(result.subprocessIds).toContain("sub-1");
    expect(result.subprocessIds).toContain("sub-2");
  });

  it("launches parallel phases in first step", () => {
    setupMockDb([
      { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "A", order_index: 0, phase_type: "simplan:exec" },
      { id: 2, plan_id: 10, step_number: 1, title: "P2", status: "pending", complexity: 2, commit_message: null, prompt: "B", order_index: 1, phase_type: "simplan:exec" },
    ]);

    startExecuteAgent(baseOptions);

    expect(startUnifiedAgent).toHaveBeenCalledTimes(2);
  });

  it("passes cwd to each phase", () => {
    setupMockDb([
      { id: 1, plan_id: 10, step_number: 1, title: "P1", status: "pending", complexity: 1, commit_message: null, prompt: "A", order_index: 0, phase_type: "simplan:exec" },
    ]);

    startExecuteAgent({ ...baseOptions, cwd: "/custom/path" });

    expect(startUnifiedAgent).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/custom/path" }),
    );
  });
});

describe("getAutonomyLevel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 (default) when no setting found", async () => {
    const { resolveSetting } = await import("../db/settings");
    (resolveSetting as any).mockReturnValue(null);
    // Number(null) = 0, which is not 1/2/3, so defaults to 1
    expect(getAutonomyLevel(1, 1)).toBe(1);
  });

  it("returns parsed integer from setting", async () => {
    const { resolveSetting } = await import("../db/settings");
    (resolveSetting as any).mockReturnValue("2");
    expect(getAutonomyLevel(1, 1)).toBe(2);
  });

  it("returns 1 for level 1 setting", async () => {
    const { resolveSetting } = await import("../db/settings");
    (resolveSetting as any).mockReturnValue("1");
    expect(getAutonomyLevel(1, 1)).toBe(1);
  });
});
