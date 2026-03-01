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

import { createRetroMcpServer } from "./retro-server";
import { getDatabase } from "../../db/database";
import { createMockDb } from "../../test-utils";

const mockGetDatabase = vi.mocked(getDatabase);

function getToolHandler(server: ReturnType<typeof createRetroMcpServer>, toolName: string) {
  const tools = (server as any).tools as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>;
  const t = tools.find((t) => t.name === toolName);
  if (!t) throw new Error(`Tool "${toolName}" not found`);
  return t.handler;
}

describe("createRetroMcpServer", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("creates a server named 'productdevr-retro'", () => {
    const server = createRetroMcpServer(10, 100);
    expect((server as any).name).toBe("productdevr-retro");
  });

  describe("read_prd tool", () => {
    it("returns PRD content when available", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ prd: "# My Feature PRD\n\nContent here" }) });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_prd");
      const result = await handler({}) as any;

      expect(result.content[0].text).toContain("# My Feature PRD");
    });

    it("returns 'No PRD available.' when prd is null", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ prd: null }) });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_prd");
      const result = await handler({}) as any;

      expect(result.content[0].text).toBe("No PRD available.");
    });

    it("returns 'No PRD available.' when feature not found", async () => {
      db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_prd");
      const result = await handler({}) as any;

      expect(result.content[0].text).toBe("No PRD available.");
    });
  });

  describe("list_conversations tool", () => {
    it("returns list of sessions with metadata", async () => {
      db.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          { id: 1, agent_type: "plan", status: "completed", started_at: "2024-01-01", ended_at: "2024-01-01", message_count: 12 },
          { id: 2, agent_type: "execute", status: "completed", started_at: "2024-01-02", ended_at: "2024-01-02", message_count: 45 },
        ]),
      });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "list_conversations");
      const result = await handler({}) as any;

      expect(result.content[0].text).toContain("2 sessions");
      expect(result.content[0].text).toContain("Session 1 [plan]");
      expect(result.content[0].text).toContain("messages=12");
      expect(result.content[0].text).toContain("Session 2 [execute]");
      expect(result.content[0].text).toContain("messages=45");
    });

    it("returns message when no sessions found", async () => {
      db.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "list_conversations");
      const result = await handler({}) as any;

      expect(result.content[0].text).toContain("No agent sessions found");
    });
  });

  describe("read_conversation tool", () => {
    it("returns paginated messages with metadata", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 3 }) };
        return {
          all: vi.fn().mockReturnValue([
            { role: "user", content: "Hello agent", message_type: "text", tool_name: null },
            { role: "assistant", content: "I will help you", message_type: "text", tool_name: null },
            { role: "assistant", content: "Done", message_type: "tool_use", tool_name: "mark_agent_done" },
          ]),
        };
      });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_conversation");
      const result = await handler({ session_id: 1 }) as any;

      expect(result.content[0].text).toContain("[user] Hello agent");
      expect(result.content[0].text).toContain("[assistant] I will help you");
      expect(result.content[0].text).toContain("tool=mark_agent_done");
      expect(result.content[0].text).toContain("Messages 1-3 of 3 total");
    });

    it("indicates pagination when more messages available", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 100 }) };
        return {
          all: vi.fn().mockReturnValue(
            Array.from({ length: 50 }, (_, i) => ({
              role: "user",
              content: `Message ${i}`,
              message_type: "text",
              tool_name: null,
            })),
          ),
        };
      });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_conversation");
      const result = await handler({ session_id: 1, offset: 0, limit: 50 }) as any;

      expect(result.content[0].text).toContain("more available");
      expect(result.content[0].text).toContain("Messages 1-50 of 100 total");
    });

    it("shows correct offset in pagination summary", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 100 }) };
        return {
          all: vi.fn().mockReturnValue([
            { role: "assistant", content: "Page 2 message", message_type: "text", tool_name: null },
          ]),
        };
      });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_conversation");
      const result = await handler({ session_id: 1, offset: 50, limit: 1 }) as any;

      expect(result.content[0].text).toContain("Messages 51-51 of 100 total");
    });

    it("returns message when session has no messages", async () => {
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 0 }) };
        return { all: vi.fn().mockReturnValue([]) };
      });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_conversation");
      const result = await handler({ session_id: 1 }) as any;

      expect(result.content[0].text).toContain("No messages found for session 1");
    });

    it("uses default offset=0 and limit=50 when not provided", async () => {
      const allFn = vi.fn().mockReturnValue([]);
      db.prepare.mockImplementation((sql: string) => {
        if (sql.includes("COUNT(*)")) return { get: vi.fn().mockReturnValue({ cnt: 0 }) };
        return { all: allFn };
      });

      const server = createRetroMcpServer(10, 100);
      const handler = getToolHandler(server, "read_conversation");
      await handler({ session_id: 5 });

      expect(allFn).toHaveBeenCalledWith(5, 50, 0);
    });
  });
});
