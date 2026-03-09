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

import { createRiskMcpServer } from "./risk-server";
import { getDatabase } from "../../db/database";
import { notifyDbUpdated } from "../session-persistence";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

function getToolHandler(server: ReturnType<typeof createRiskMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

describe("createRiskMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'cadence-risk'", () => {
    const server = createRiskMcpServer(1, 10, 100);
    expect((server as any).name).toBe("cadence-risk");
  });

  describe("finalize_phases tool (risk)", () => {
    it("finalizes draft mitigation phases", async () => {
      const runFn = vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 });
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id")) return { all: vi.fn().mockReturnValue([
          { id: 8, title: "Mitigate Y", step_number: 1 },
        ]) };
        return { run: runFn };
      });

      const server = createRiskMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.content[0].text).toContain("Finalized 1 mitigation phases");
      expect(runFn).toHaveBeenCalled();
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE features SET status = 'in-progress'"));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE plans SET status = 'active'"));
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("returns error when plan_id mismatch", async () => {
      const server = createRiskMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 2 }) as any;

      expect(result.isError).toBe(true);
    });

    it("returns error when no draft phases", async () => {
      db.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      const server = createRiskMcpServer(1, 10, 100);
      const handler = getToolHandler(server, "finalize_phases");
      const result = await handler({ plan_id: 1 }) as any;

      expect(result.isError).toBe(true);
    });
  });
});
