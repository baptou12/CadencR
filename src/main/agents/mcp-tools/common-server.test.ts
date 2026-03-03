import { describe, it, expect, vi } from "vitest";

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

import { createCommonMcpServer, createWorkflowSessionMcpServer } from "./common-server";

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
