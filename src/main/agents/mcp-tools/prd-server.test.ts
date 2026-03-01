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

import { createPrdMcpServer } from "./prd-server";
import { getDatabase } from "../../db/database";
import { notifyDbUpdated } from "../session-persistence";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

function getToolHandler(server: ReturnType<typeof createPrdMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

describe("createPrdMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'productdevr-prd'", () => {
    const server = createPrdMcpServer(10, 100);
    expect((server as any).name).toBe("productdevr-prd");
  });

  describe("create_prd tool", () => {
    it("stores full PRD content", async () => {
      const runFn = vi.fn();
      db.prepare.mockReturnValue({ run: runFn });

      const server = createPrdMcpServer(10, 100);
      const handler = getToolHandler(server, "create_prd");
      const result = await handler({ prd: "# My PRD\n\nContent here" }) as any;

      expect(result.content[0].text).toContain("PRD created successfully");
      expect(runFn).toHaveBeenCalledWith("# My PRD\n\nContent here", 10);
      expect(mockNotify).toHaveBeenCalledWith("feature", 10);
    });
  });

  describe("edit_prd tool", () => {
    it("successfully replaces a unique string", async () => {
      const runFn = vi.fn();
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("SELECT prd")) return { get: vi.fn().mockReturnValue({ prd: "Hello world, this is a PRD." }) };
        return { run: runFn };
      });

      const server = createPrdMcpServer(10, 100);
      const handler = getToolHandler(server, "edit_prd");
      const result = await handler({ old_string: "Hello world", new_string: "Goodbye world" }) as any;

      expect(result.content[0].text).toContain("PRD updated successfully");
      expect(runFn).toHaveBeenCalledWith("Goodbye world, this is a PRD.", 10);
      expect(mockNotify).toHaveBeenCalledWith("feature", 10);
    });

    it("returns error when no PRD exists", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ prd: null }) });

      const server = createPrdMcpServer(10, 100);
      const handler = getToolHandler(server, "edit_prd");
      const result = await handler({ old_string: "foo", new_string: "bar" }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No PRD exists yet");
    });

    it("returns error when old_string not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ prd: "Some PRD content" }) });

      const server = createPrdMcpServer(10, 100);
      const handler = getToolHandler(server, "edit_prd");
      const result = await handler({ old_string: "nonexistent", new_string: "bar" }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("old_string not found");
    });

    it("returns error when old_string matches multiple times", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ prd: "foo bar foo baz foo" }) });

      const server = createPrdMcpServer(10, 100);
      const handler = getToolHandler(server, "edit_prd");
      const result = await handler({ old_string: "foo", new_string: "qux" }) as any;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("found 3 times");
    });
  });
});
