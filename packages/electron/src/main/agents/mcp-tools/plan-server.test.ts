import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../../db/database");
vi.mock("../effect-helpers", () => ({
  notifyDbUpdated: vi.fn(),
}));

import { createPlanMcpServer } from "./plan-server";
import { getDatabase } from "../../db/database";
import { notifyDbUpdated } from "../effect-helpers";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

function getToolHandler(server: ReturnType<typeof createPlanMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

describe("createPlanMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'cadence-plan'", () => {
    const server = createPlanMcpServer(1, 10, 100);
    expect((server as any).name).toBe("cadence-plan");
  });

  describe("update_plan tool", () => {
    it("updates specified plan fields", async () => {
      const runFn = vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 });
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
    const fullPlanRow = { id: 1, feature_id: 10, title: "T", status: "active", raw_markdown: null, summary: null, context: null, clarifications: null, completion_conditions: null, created_at: "2024-01-01", updated_at: "2024-01-01" };

    it("returns plan markdown when no callback provided", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue(fullPlanRow) };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const server = createPlanMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "show_plan");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("# Plan: T");
    });

    it("calls onShowPlan callback and returns approved message", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue(fullPlanRow) };
        if (sql.includes("UPDATE plans")) return { run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }) };
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
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue(fullPlanRow) };
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
        if (sql.includes("FROM plans")) return { get: vi.fn().mockReturnValue(fullPlanRow) };
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
      const planId = 555;
      let planStatus = "draft";

      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT *") && sql.includes("FROM plans")) {
          return { get: vi.fn().mockImplementation(() => ({
            id: planId, feature_id: 10, title: "T", status: planStatus, raw_markdown: null,
            summary: null, context: null, clarifications: null,
            completion_conditions: null, created_at: "2024-01-01", updated_at: "2024-01-01",
          })) };
        }
        if (sql.includes("FROM plans WHERE id")) {
          return { get: vi.fn().mockImplementation(() => ({
            id: planId, feature_id: 10, plan_status: planStatus,
          })) };
        }
        if (sql.includes("UPDATE plans SET status = 'approved'")) {
          return { run: vi.fn().mockImplementation(() => { planStatus = "approved"; return { changes: 1, lastInsertRowid: 0 }; }) };
        }
        if (sql.includes("FROM features WHERE id")) {
          return { get: vi.fn().mockReturnValue({ status: "draft" }) };
        }
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 3 }) };
        // Default: return proper run result for UPDATE statements used in transaction
        return { get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]), run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }) };
      });

      db.transaction.mockImplementation((fn: () => void) => fn);

      const onShowPlan = vi.fn().mockResolvedValue({ approved: true });
      const server = createPlanMcpServer(planId, 10, 100, onShowPlan);

      const showHandler = getToolHandler(server, "show_plan");
      await showHandler({ plan_id: planId });

      const finalizeHandler = getToolHandler(server, "finalize_plan");
      const result = await finalizeHandler({ plan_id: planId }) as any;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("finalized");
      expect(mockNotify).toHaveBeenCalledWith("feature", 10);
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
});
