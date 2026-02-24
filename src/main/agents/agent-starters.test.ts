/**
 * Tests for agent-starters.ts — specialized agent start functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockReturnValue({ lastInsertRowid: 10 }),
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([]),
    })),
  })),
}));

vi.mock("./unified-agent", () => ({
  startUnifiedAgent: vi.fn().mockReturnValue({
    subprocessId: "sub-1",
    agentType: "plan",
    sessionDbId: 1,
  }),
}));

vi.mock("./state-transitions", () => ({
  transitionFeature: vi.fn(),
  transitionPhase: vi.fn(),
  transitionPhaseIf: vi.fn(),
  transitionAgentSession: vi.fn(),
}));

vi.mock("./agent-configs", () => ({
  createSessionConfig: vi.fn().mockReturnValue({ agentType: "session" }),
  createPlanConfig: vi.fn().mockReturnValue({ agentType: "plan" }),
  createBrainstormConfig: vi.fn().mockReturnValue({ agentType: "brainstorm" }),
  createRiskConfig: vi.fn().mockReturnValue({ agentType: "risk" }),
  createReviewConfig: vi.fn().mockReturnValue({ agentType: "review" }),
  createQaConfig: vi.fn().mockReturnValue({ agentType: "execute" }),
}));

vi.mock("./execute-agent", () => ({
  getAutonomyLevel: vi.fn().mockReturnValue(3),
}));

import {
  startSessionAgent,
  startPlanAgent,
  startBrainstormAgent,
  startRiskAgent,
  startReviewAgent,
  startQaAgent,
  addFixPhase,
} from "./agent-starters";
import { startUnifiedAgent } from "./unified-agent";
import { transitionFeature } from "./state-transitions";
import { getDatabase } from "../db/database";

describe("agent-starters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (startUnifiedAgent as any).mockReturnValue({
      subprocessId: "sub-1",
      agentType: "plan",
      sessionDbId: 1,
    });
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockReturnValue({ lastInsertRowid: 10 }),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      })),
    });
  });

  describe("startSessionAgent", () => {
    it("calls startUnifiedAgent with session config", () => {
      const result = startSessionAgent({
        featureId: 1,
        projectId: 2,
        prompt: "Hello",
        cwd: "/project",
      });

      expect(startUnifiedAgent).toHaveBeenCalledWith({ agentType: "session" });
      expect(result.subprocessId).toBe("sub-1");
    });
  });

  describe("startPlanAgent", () => {
    it("creates a plan record before starting", () => {
      const planRun = vi.fn().mockReturnValue({ lastInsertRowid: 5 });
      const settingsRun = vi.fn();
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("INSERT INTO plans")) return { run: planRun };
          if (sql.includes("INSERT INTO feature_settings")) return { run: settingsRun };
          return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      startPlanAgent({
        featureId: 1,
        projectId: 2,
        description: "Build a feature",
        cwd: "/project",
      });

      expect(planRun).toHaveBeenCalledWith(1, expect.any(String));
      expect(settingsRun).toHaveBeenCalledWith(1, "current_plan_id", "5");
    });

    it("returns result from startUnifiedAgent", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation(() => ({
          run: vi.fn().mockReturnValue({ lastInsertRowid: 5 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        })),
      });

      const result = startPlanAgent({
        featureId: 1,
        projectId: 2,
        description: "Build feature",
        cwd: "/project",
      });

      expect(result.subprocessId).toBe("sub-1");
    });
  });

  describe("startBrainstormAgent", () => {
    it("creates a plan record before starting", () => {
      const planRun = vi.fn().mockReturnValue({ lastInsertRowid: 6 });
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("INSERT INTO plans")) return { run: planRun };
          return {
            run: vi.fn().mockReturnValue({ lastInsertRowid: 6 }),
            get: vi.fn(),
            all: vi.fn().mockReturnValue([]),
          };
        }),
      });

      startBrainstormAgent({
        featureId: 1,
        projectId: 2,
        description: "Brainstorm ideas",
        cwd: "/project",
      });

      expect(planRun).toHaveBeenCalledWith(1, expect.stringContaining("Brainstorm"));
    });
  });

  describe("startRiskAgent", () => {
    it("fetches plan for context and calls startUnifiedAgent", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("SELECT id, raw_markdown, title FROM plans")) {
            return { get: vi.fn().mockReturnValue({ id: 1, raw_markdown: "## Plan", title: "Test" }) };
          }
          return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      startRiskAgent({ featureId: 1, projectId: 2, cwd: "/project" });

      expect(startUnifiedAgent).toHaveBeenCalledWith({ agentType: "risk" });
    });

    it("works without a plan (no raw_markdown)", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation(() => ({
          run: vi.fn(),
          get: vi.fn().mockReturnValue(null),
          all: vi.fn().mockReturnValue([]),
        })),
      });

      expect(() =>
        startRiskAgent({ featureId: 1, projectId: 2, cwd: "/project" }),
      ).not.toThrow();
    });
  });

  describe("startReviewAgent", () => {
    it("transitions feature to review status", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("SELECT id FROM plans")) {
            return { get: vi.fn().mockReturnValue({ id: 1 }) };
          }
          return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      startReviewAgent({ featureId: 1, projectId: 2, cwd: "/project" });

      expect(transitionFeature).toHaveBeenCalledWith(expect.anything(), 1, "review");
    });

    it("throws if no plan found", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation(() => ({
          run: vi.fn(),
          get: vi.fn().mockReturnValue(null),
          all: vi.fn().mockReturnValue([]),
        })),
      });

      expect(() =>
        startReviewAgent({ featureId: 1, projectId: 2, cwd: "/project" }),
      ).toThrow("No plan found");
    });
  });

  describe("addFixPhase", () => {
    it("creates a fix phase in the plan", () => {
      const phaseRun = vi.fn().mockReturnValue({ lastInsertRowid: 20 });
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("SELECT id FROM plans")) {
            return { get: vi.fn().mockReturnValue({ id: 1 }) };
          }
          if (sql.includes("SELECT step_number, order_index")) {
            return { get: vi.fn().mockReturnValue({ step_number: 2, order_index: 0 }) };
          }
          if (sql.includes("INSERT INTO phases")) return { run: phaseRun };
          return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      const result = addFixPhase(1, "Fix the failing tests");

      expect(phaseRun).toHaveBeenCalledWith(
        1, 3, "Review fixes", "pending", 2, "fix: address review findings", "Fix the failing tests", 0,
      );
      expect(result.phaseId).toBe(20);
    });

    it("throws if no plan found", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation(() => ({
          run: vi.fn(),
          get: vi.fn().mockReturnValue(null),
          all: vi.fn().mockReturnValue([]),
        })),
      });

      expect(() => addFixPhase(1, "Fix it")).toThrow("No plan found");
    });

    it("uses step 1 when no existing phases", () => {
      const phaseRun = vi.fn().mockReturnValue({ lastInsertRowid: 21 });
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("SELECT id FROM plans")) {
            return { get: vi.fn().mockReturnValue({ id: 1 }) };
          }
          if (sql.includes("SELECT step_number, order_index")) {
            return { get: vi.fn().mockReturnValue(null) };
          }
          if (sql.includes("INSERT INTO phases")) return { run: phaseRun };
          return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      addFixPhase(1, "Add tests");

      expect(phaseRun).toHaveBeenCalledWith(
        expect.any(Number),
        1,
        expect.any(String),
        "pending",
        expect.any(Number),
        expect.any(String),
        "Add tests",
        0,
      );
    });
  });

  describe("startQaAgent", () => {
    it("throws when no active plan", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("qa_prompt FROM projects")) {
            return { get: vi.fn().mockReturnValue({ qa_prompt: null }) };
          }
          return {
            run: vi.fn(),
            get: vi.fn().mockReturnValue(null),
            all: vi.fn().mockReturnValue([]),
          };
        }),
      });

      expect(() =>
        startQaAgent({ featureId: 1, projectId: 2, cwd: "/project" }),
      ).toThrow("No active plan found for QA");
    });

    it("calls startUnifiedAgent with QA config", () => {
      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("qa_prompt FROM projects")) {
            return { get: vi.fn().mockReturnValue({ qa_prompt: "Run tests" }) };
          }
          if (sql.includes("SELECT id FROM plans WHERE")) {
            return { get: vi.fn().mockReturnValue({ id: 5 }) };
          }
          if (sql.includes("step_number, title, implementation_notes")) {
            return { all: vi.fn().mockReturnValue([]) };
          }
          if (sql.includes("MAX(step_number)")) {
            return { get: vi.fn().mockReturnValue({ max_step: 2 }) };
          }
          if (sql.includes("phase_type IS NOT")) {
            return { get: vi.fn().mockReturnValue({ cnt: 0 }) };
          }
          if (sql.includes("SELECT prd FROM features")) {
            return { get: vi.fn().mockReturnValue({ prd: null }) };
          }
          return { run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      startQaAgent({ featureId: 1, projectId: 2, cwd: "/project" });

      expect(startUnifiedAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: "execute" }),
      );
    });

    it("adds qa_auto_execute completion action to config", async () => {
      const { createQaConfig } = await import("./agent-configs") as any;
      const mockConfig = {
        agentType: "qa",
        completionActions: [{ event: "store_qa_report", handler: vi.fn() }],
      };
      createQaConfig.mockReturnValue(mockConfig);

      (getDatabase as any).mockReturnValue({
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("qa_prompt FROM projects")) {
            return { get: vi.fn().mockReturnValue({ qa_prompt: "Run tests" }) };
          }
          if (sql.includes("SELECT id FROM plans WHERE")) {
            return { get: vi.fn().mockReturnValue({ id: 5 }) };
          }
          if (sql.includes("step_number, title, implementation_notes")) {
            return { all: vi.fn().mockReturnValue([]) };
          }
          if (sql.includes("MAX(step_number)")) {
            return { get: vi.fn().mockReturnValue({ max_step: 2 }) };
          }
          if (sql.includes("phase_type IS NOT")) {
            return { get: vi.fn().mockReturnValue({ cnt: 0 }) };
          }
          if (sql.includes("SELECT prd FROM features")) {
            return { get: vi.fn().mockReturnValue({ prd: null }) };
          }
          return { run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
        }),
      });

      startQaAgent({ featureId: 1, projectId: 2, cwd: "/project" });

      // The config passed to startUnifiedAgent should have qa_auto_execute action
      const passedConfig = (startUnifiedAgent as any).mock.calls[0][0];
      const actionEvents = passedConfig.completionActions.map((a: any) => a.event);
      expect(actionEvents).toContain("qa_auto_execute");
    });
  });
});
