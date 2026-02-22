import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before any imports — the test-setup.ts throws on the real SDK,
// so we intercept with a lightweight shim that captures tool definitions.
vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  return {
    createSdkMcpServer: vi.fn((opts: { name: string; tools: unknown[] }) => ({
      name: opts.name,
      tools: opts.tools,
    })),
    tool: vi.fn(
      (
        name: string,
        _description: string,
        _schema: unknown,
        handler: (args: unknown) => Promise<unknown>,
      ) => ({ name, handler }),
    ),
  };
});

vi.mock("../db/database");
vi.mock("./session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));
vi.mock("./state-transitions", () => ({
  transitionPhase: vi.fn(),
  transitionFeature: vi.fn(),
}));

import {
  renderPlanMarkdown,
  createPlanMcpServer,
  createExecuteMcpServer,
  createQaMcpServer,
  createReviewMcpServer,
  createCommonMcpServer,
  createWorkflowSessionMcpServer,
} from "./mcp-tools";
import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./session-persistence";
import { transitionPhase, transitionFeature } from "./state-transitions";
import { createMockDb } from "../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);
const mockTransitionPhase = vi.mocked(transitionPhase);
const mockTransitionFeature = vi.mocked(transitionFeature);

// ---------------------------------------------------------------------------
// Helper: extract a named tool handler from the MCP server
// ---------------------------------------------------------------------------
function getToolHandler(server: ReturnType<typeof createPlanMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

// ---------------------------------------------------------------------------
// renderPlanMarkdown
// ---------------------------------------------------------------------------
describe("renderPlanMarkdown", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("returns 'Plan not found.' when plan does not exist", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), all: vi.fn().mockReturnValue([]) });
    expect(renderPlanMarkdown(999)).toBe("Plan not found.");
  });

  it("renders plan title and sections", () => {
    db.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue({
        id: 1,
        title: "My Plan",
        summary: "A summary",
        context: "Some context",
        clarifications: "Q&A",
        completion_conditions: "All tests pass",
      }),
      all: vi.fn().mockReturnValue([]),
    }));

    const result = renderPlanMarkdown(1);
    expect(result).toContain("# Plan: My Plan");
    expect(result).toContain("## Summary\n\nA summary");
    expect(result).toContain("## Context\n\nSome context");
    expect(result).toContain("## Clarifications\n\nQ&A");
    expect(result).toContain("## Completion Conditions\n\nAll tests pass");
  });

  it("includes phases in the output", () => {
    const getPlan = vi.fn().mockReturnValue({ id: 1, title: "Plan", summary: null, context: null, clarifications: null, completion_conditions: null });
    const allPhases = vi.fn().mockReturnValue([
      {
        id: 10,
        step_number: 1,
        title: "Phase One",
        status: "pending",
        phase_type: "value",
        complexity: 3,
        commit_message: "feat: do things",
        prompt: "Do this thing",
        implementation_notes: null,
        deviations: null,
        order_index: 0,
        plan_id: 1,
      },
    ]);

    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans")) return { get: getPlan };
      return { all: allPhases };
    });

    const result = renderPlanMarkdown(1);
    expect(result).toContain("## Phases");
    expect(result).toContain("### Phase 1: Phase One");
    expect(result).toContain("**Status**: pending");
    expect(result).toContain("**Commit message**: feat: do things");
  });

  it("skips optional sections when null", () => {
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue({ id: 1, title: "Lean Plan", summary: null, context: null, clarifications: null, completion_conditions: null }) };
      return { all: vi.fn().mockReturnValue([]) };
    });

    const result = renderPlanMarkdown(1);
    expect(result).not.toContain("## Summary");
    expect(result).not.toContain("## Context");
  });
});

// ---------------------------------------------------------------------------
// createPlanMcpServer tool handlers
// ---------------------------------------------------------------------------
describe("createPlanMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'productdevr-plan'", () => {
    const server = createPlanMcpServer(1, 10, 100);
    expect((server as any).name).toBe("productdevr-plan");
  });

  describe("update_plan tool", () => {
    it("updates specified plan fields", async () => {
      const runFn = vi.fn();
      db.prepare.mockReturnValue({ run: runFn });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_plan");

      const result = await handler({ plan_id: 1, title: "New Title", summary: "Updated summary" }) as any;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Plan updated");
      expect(runFn).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith("plan", 10);
    });

    it("returns error when no fields provided", async () => {
      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_plan");

      const result = await handler({ plan_id: 1 }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No fields to update");
    });
  });

  describe("show_plan tool", () => {
    it("returns plan markdown when no callback provided", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue({ id: 1, title: "T", summary: null, context: null, clarifications: null, completion_conditions: null }) };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "show_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("# Plan: T");
    });

    it("calls onShowPlan callback and returns approved message", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue({ id: 1, title: "T", summary: null, context: null, clarifications: null, completion_conditions: null }) };
        if (sql.includes("UPDATE plans")) return { run: vi.fn() };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const onShowPlan = vi.fn().mockResolvedValue({ approved: true });
      const server = createPlanMcpServer(1, 10, 100, onShowPlan);
      const handler = getToolHandler(server, "show_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(onShowPlan).toHaveBeenCalled();
      expect(result.content[0].text).toContain("approved");
    });

    it("returns error with feedback when rejected", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue({ id: 1, title: "T", summary: null, context: null, clarifications: null, completion_conditions: null }) };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const onShowPlan = vi.fn().mockResolvedValue({ approved: false, feedback: "needs more phases" });
      const server = createPlanMcpServer(1, 10, 100, onShowPlan);
      const handler = getToolHandler(server, "show_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("needs more phases");
    });

    it("returns error when callback throws", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue({ id: 1, title: "T", summary: null, context: null, clarifications: null, completion_conditions: null }) };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const onShowPlan = vi.fn().mockRejectedValue(new Error("timeout"));
      const server = createPlanMcpServer(1, 10, 100, onShowPlan);
      const handler = getToolHandler(server, "show_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("timeout");
    });
  });

  describe("finalize_plan tool", () => {
    it("returns error when no draft phases", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ cnt: 0 }), run: vi.fn(), all: vi.fn().mockReturnValue([]) });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No draft phases");
    });

    it("returns error if show_plan was not called first (plan not approved)", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ cnt: 2 }), run: vi.fn(), all: vi.fn().mockReturnValue([]) });

      const server = createPlanMcpServer(99, 10, 100);
      const handler = getToolHandler(server, "finalize_plan");
      const result = await handler({ plan_id: 99 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("show_plan");
    });

    it("finalizes plan after approval", async () => {
      // First approve via show_plan, then finalize
      const planId = 555;
      let planStatus = "draft";

      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans WHERE id")) {
          return { get: vi.fn().mockImplementation(() => ({
            id: planId, title: "T", summary: null, context: null, clarifications: null,
            completion_conditions: null, feature_id: 10, plan_status: planStatus,
          })) };
        }
        if (sql.includes("UPDATE plans SET status = 'approved'")) {
          return { run: vi.fn().mockImplementation(() => { planStatus = "approved"; }) };
        }
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 3 }) };
        return { get: vi.fn(), all: vi.fn().mockReturnValue([]), run: vi.fn() };
      });

      db.transaction.mockImplementation((fn: () => void) => fn);

      const onShowPlan = vi.fn().mockResolvedValue({ approved: true });
      const server = createPlanMcpServer(planId, 10, 100, onShowPlan);

      // Approve the plan first
      const showHandler = getToolHandler(server, "show_plan");
      await showHandler({ plan_id: planId });

      // Now finalize
      const finalizeHandler = getToolHandler(server, "finalize_plan");
      const result = await finalizeHandler({ plan_id: planId }) as any;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("finalized");
      expect(mockTransitionFeature).toHaveBeenCalledWith(db, 10, "planned");
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });
    it("rejects finalize when plan status is not 'approved' (DB-persisted approval)", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans WHERE id")) {
          return { get: vi.fn().mockReturnValue({ id: 1, feature_id: 10, plan_status: "draft" }) };
        }
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 3 }) };
        return { get: vi.fn(), all: vi.fn().mockReturnValue([]), run: vi.fn() };
      });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not been approved");
    });
  });

  describe("create_phase tool", () => {
    it("creates a phase and returns its id", async () => {
      const runFn = vi.fn().mockReturnValue({ lastInsertRowid: 42 });
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ max_idx: 0 }), run: runFn, all: vi.fn().mockReturnValue([]) });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "create_phase");
      const result = await handler({ plan_id: 1, step_number: 1, title: "My Phase", prompt: "Do stuff" }) as any;

      expect(result.content[0].text).toContain("id=42");
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("uses complexity default of 3 when not provided", async () => {
      const runFn = vi.fn().mockReturnValue({ lastInsertRowid: 1 });
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ max_idx: null }), run: runFn, all: vi.fn().mockReturnValue([]) });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "create_phase");
      await handler({ plan_id: 1, step_number: 1, title: "T", prompt: "P" });

      // Third positional arg to run() is complexity — expect 3
      const callArgs = runFn.mock.calls[0];
      expect(callArgs[3]).toBe(3);
    });

    it("uses phase_type 'value' as default", async () => {
      const runFn = vi.fn().mockReturnValue({ lastInsertRowid: 1 });
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ max_idx: 5 }), run: runFn, all: vi.fn().mockReturnValue([]) });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "create_phase");
      await handler({ plan_id: 1, step_number: 2, title: "T", prompt: "P" });

      const callArgs = runFn.mock.calls[0];
      // Last arg before order_index is phase_type
      expect(callArgs[callArgs.length - 1]).toBe("value");
    });
  });

  describe("update_phase tool", () => {
    it("updates allowed fields on a draft phase", async () => {
      const runFn = vi.fn();
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT status")) return { get: vi.fn().mockReturnValue({ status: "draft", plan_id: 1 }) };
        return { run: runFn };
      });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_phase");
      const result = await handler({ phase_id: 5, title: "New Title" }) as any;

      expect(result.content[0].text).toContain("updated");
      expect(runFn).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("returns error when phase not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn() });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_phase");
      const result = await handler({ phase_id: 99, title: "X" }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns error when phase does not belong to plan", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "draft", plan_id: 999 }), run: vi.fn() });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_phase");
      const result = await handler({ phase_id: 5, title: "X" }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("does not belong");
    });

    it("returns error when phase is not draft", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "pending", plan_id: 1 }), run: vi.fn() });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_phase");
      const result = await handler({ phase_id: 5, title: "X" }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("only 'draft' phases");
    });

    it("returns error when no fields to update", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "draft", plan_id: 1 }), run: vi.fn() });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "update_phase");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No fields");
    });
  });

  describe("remove_phase tool", () => {
    it("removes a draft phase", async () => {
      const runFn = vi.fn();
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT status")) return { get: vi.fn().mockReturnValue({ status: "draft", plan_id: 1 }) };
        return { run: runFn };
      });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "remove_phase");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.content[0].text).toContain("removed");
      expect(runFn).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("returns error when phase not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn() });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "remove_phase");
      const result = await handler({ phase_id: 99 }) as any;

      expect(result.isError).toBe(true);
    });

    it("returns error when phase is not draft", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "running", plan_id: 1 }), run: vi.fn() });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "remove_phase");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("only 'draft' phases");
    });
  });

  describe("mark_agent_done tool", () => {
    it("marks session completed and notifies", async () => {
      const runFn = vi.fn();
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT status")) return { get: vi.fn().mockReturnValue({ status: "running", agent_type: "plan" }) };
        return { run: runFn };
      });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "mark_agent_done");
      const result = await handler({ summary: "All done" }) as any;

      expect(result.content[0].text).toContain("completed");
      expect(runFn).toHaveBeenCalledWith(100);
      expect(mockNotify).toHaveBeenCalledWith("agent_session", 10);
    });
  });
});

// ---------------------------------------------------------------------------
// Shared read-only tools (read_plan, list_phases, read_phase)
// ---------------------------------------------------------------------------
describe("shared read-only tools", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  describe("read_plan tool", () => {
    it("returns plan markdown", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue({ id: 1, title: "T", summary: null, context: null, clarifications: null, completion_conditions: null }) };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "read_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("# Plan: T");
    });
  });

  describe("list_phases tool", () => {
    it("lists phases with details", async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          { id: 1, step_number: 1, title: "Phase A", status: "pending", phase_type: "value", complexity: 3 },
        ]),
      });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "list_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("Phase A");
      expect(result.content[0].text).toContain("[pending]");
    });

    it("returns message when no phases found", async () => {
      db.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "list_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("No phases found");
    });
  });

  describe("read_phase tool", () => {
    it("returns phase details", async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 5,
          title: "Implement auth",
          plan_id: 1,
          step_number: 2,
          status: "pending",
          phase_type: "value",
          complexity: 4,
          commit_message: "feat: auth",
          order_index: 0,
          prompt: "Build auth",
          implementation_notes: null,
          deviations: null,
        }),
      });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "read_phase");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.content[0].text).toContain("Implement auth");
      expect(result.content[0].text).toContain("Build auth");
    });

    it("returns error when phase not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "read_phase");
      const result = await handler({ phase_id: 999 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("includes optional fields when present", async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 5,
          title: "Phase",
          plan_id: 1,
          step_number: 1,
          status: "completed",
          phase_type: "value",
          complexity: 2,
          commit_message: null,
          order_index: 0,
          prompt: null,
          implementation_notes: "Did it",
          deviations: "Minor tweak",
        }),
      });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "read_phase");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.content[0].text).toContain("Did it");
      expect(result.content[0].text).toContain("Minor tweak");
    });
  });
});

// ---------------------------------------------------------------------------
// createExecuteMcpServer
// ---------------------------------------------------------------------------
describe("createExecuteMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'productdevr-execute'", () => {
    const server = createExecuteMcpServer(10, 100);
    expect((server as any).name).toBe("productdevr-execute");
  });

  describe("mark_phase_done tool", () => {
    it("transitions phase to completed", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "running" }) });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 5, implementation_notes: "Done it", deviations: "None" }) as any;

      expect(result.content[0].text).toContain("completed");
      expect(mockTransitionPhase).toHaveBeenCalledWith(db, 5, "completed", 10, {
        implementation_notes: "Done it",
        deviations: "None",
      });
    });

    it("uses null for optional fields when not provided", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "running" }) });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      await handler({ phase_id: 5 });

      expect(mockTransitionPhase).toHaveBeenCalledWith(db, 5, "completed", 10, {
        implementation_notes: null,
        deviations: null,
      });
    });

    it("returns error when phase not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 99 }) as any;

      expect(result.isError).toBe(true);
    });

    it("returns error when phase is not running", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "pending" }) });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("expected 'running'");
    });
  });
});

// ---------------------------------------------------------------------------
// createQaMcpServer
// ---------------------------------------------------------------------------
describe("createQaMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'productdevr-qa'", () => {
    const server = createQaMcpServer(1, 10, 100);
    expect((server as any).name).toBe("productdevr-qa");
  });

  describe("mark_phase_done tool (QA)", () => {
    it("transitions phase to completed with implementation_notes", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "running" }) });

      const server = createQaMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 5, implementation_notes: "All tests passed", deviations: "None" }) as any;

      expect(result.content[0].text).toContain("completed");
      expect(mockTransitionPhase).toHaveBeenCalledWith(db, 5, "completed", 10, {
        implementation_notes: "All tests passed",
        deviations: "None",
      });
    });

    it("returns error when phase is not running", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ status: "pending" }) });

      const server = createQaMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("expected 'running'");
    });

    it("returns error when phase not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const server = createQaMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 99 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("finalize_phases tool", () => {
    it("finalizes draft phases", async () => {
      const runFn = vi.fn();
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id")) return { all: vi.fn().mockReturnValue([
          { id: 5, title: "Phase A", step_number: 1 },
          { id: 6, title: "Phase B", step_number: 2 },
        ]) };
        return { run: runFn };
      });

      const server = createQaMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("Finalized 2 phases");
      expect(runFn).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("returns error when plan_id does not match", async () => {
      const server = createQaMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 99 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Expected plan_id 1");
    });

    it("returns error when no draft phases", async () => {
      db.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      const server = createQaMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No draft phases");
    });
  });
});

// ---------------------------------------------------------------------------
// createReviewMcpServer
// ---------------------------------------------------------------------------
describe("createReviewMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'productdevr-review'", () => {
    const server = createReviewMcpServer(1, 10, 100);
    expect((server as any).name).toBe("productdevr-review");
  });

  describe("finalize_phases tool (review)", () => {
    it("finalizes draft fix phases", async () => {
      const runFn = vi.fn();
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id")) return { all: vi.fn().mockReturnValue([
          { id: 7, title: "Fix X", step_number: 1 },
        ]) };
        return { run: runFn };
      });

      const server = createReviewMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("Finalized 1 fix phases");
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("returns error when plan_id mismatch", async () => {
      const server = createReviewMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 2 }) as any;

      expect(result.isError).toBe(true);
    });

    it("returns error when no draft phases", async () => {
      db.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      const server = createReviewMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// createCommonMcpServer
// ---------------------------------------------------------------------------
describe("createCommonMcpServer", () => {
  it("creates a server named 'productdevr-common'", () => {
    const server = createCommonMcpServer(100, 10);
    expect((server as any).name).toBe("productdevr-common");
  });

  it("only has mark_agent_done tool", () => {
    const server = createCommonMcpServer(100, 10);
    const tools = (server as any).tools as Array<{ name: string }>;
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("mark_agent_done");
  });
});

// ---------------------------------------------------------------------------
// createWorkflowSessionMcpServer
// ---------------------------------------------------------------------------
describe("createWorkflowSessionMcpServer", () => {
  it("creates a server named 'productdevr-session'", () => {
    const server = createWorkflowSessionMcpServer(100, 10, ["mark_agent_done"]);
    expect((server as any).name).toBe("productdevr-session");
  });

  it("only includes specified tools", () => {
    const server = createWorkflowSessionMcpServer(100, 10, ["read_plan", "list_phases"]);
    const tools = (server as any).tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_plan");
    expect(names).toContain("list_phases");
    expect(names).not.toContain("read_phase");
    expect(names).not.toContain("mark_agent_done");
  });

  it("includes all allowed tools when all specified", () => {
    const server = createWorkflowSessionMcpServer(100, 10, [
      "read_plan",
      "list_phases",
      "read_phase",
      "mark_agent_done",
    ]);
    const tools = (server as any).tools as Array<{ name: string }>;
    expect(tools.length).toBe(4);
  });
});
