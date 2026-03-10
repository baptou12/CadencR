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
vi.mock("../state-transitions", () => ({
  transitionPhase: vi.fn(),
  transitionFeature: vi.fn(),
}));

import { createReviewMcpServer } from "./review-server";
import { getDatabase } from "../../db/database";
import { notifyDbUpdated } from "../effect-helpers";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

function getToolHandler(server: ReturnType<typeof createReviewMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

describe("createReviewMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'cadence-review'", () => {
    const server = createReviewMcpServer(1, 10, 100);
    expect((server as any).name).toBe("cadence-review");
  });

  describe("finalize_phases tool (review)", () => {
    it("finalizes draft fix phases", async () => {
      const runFn = vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 });
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
      expect(runFn).toHaveBeenCalled();
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE features SET status = 'in-progress'"));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE plans SET status = 'active'"));
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
