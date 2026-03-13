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

import { createExecuteMcpServer } from "./execute-server";
import { getDatabase } from "../../db/database";
import { notifyDbUpdated } from "../effect-helpers";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

function getToolHandler(server: ReturnType<typeof createExecuteMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

describe("createExecuteMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'cadence-execute'", () => {
    const server = createExecuteMcpServer(10, 100);
    expect((server as any).name).toBe("cadence-execute");
  });

  describe("mark_phase_done tool", () => {
    it("transitions phase to completed", async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ status: "running" }),
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }),
      });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 5, implementation_notes: "Done it", deviations: "None" }) as any;

      expect(result.content[0].text).toContain("completed");
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
    });

    it("uses null for optional fields when not provided", async () => {
      db.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ status: "running" }),
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }),
      });

      const server = createExecuteMcpServer(10, 100);
      const handler = getToolHandler(server, "mark_phase_done");
      const result = await handler({ phase_id: 5 }) as any;

      expect(result.content[0].text).toContain("completed");
      expect(mockNotify).toHaveBeenCalledWith("phase", 10);
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
