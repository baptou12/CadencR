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
vi.mock("../session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));
vi.mock("../state-transitions", () => ({
  transitionPhase: vi.fn(),
  transitionFeature: vi.fn(),
}));

import { createQaMcpServer } from "./qa-server";
import { getDatabase } from "../../db/database";
import { notifyDbUpdated } from "../session-persistence";
import { transitionPhase } from "../state-transitions";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);
const mockTransitionPhase = vi.mocked(transitionPhase);

function getToolHandler(server: ReturnType<typeof createQaMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

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
