import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { AgentBlock } from "./AgentBlock";
import type { AgentBlockData } from "./AgentBlock";

vi.mock("./InlineDiffBlock", () => ({
  InlineDiffBlock: ({ filePath }: { filePath: string }) => (
    <div data-testid="inline-diff">{filePath}</div>
  ),
}));

function makeBlock(overrides: Partial<AgentBlockData>): AgentBlockData {
  return {
    id: "block-1",
    type: "tool_call",
    content: "",
    ...overrides,
  };
}

describe("AgentBlock Cadencr MCP session tools", () => {
  it("renders a mark_agent_done MCP call with custom styling", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr-session__mark_agent_done",
          toolArgs: JSON.stringify({ summary: "Finished" }),
        })}
      />,
    );

    expect(screen.getByText("session")).toBeInTheDocument();
    expect(screen.getByText("Marking done")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("renders a Codex namespace MCP call with custom styling", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr_session____read_conversation",
          toolArgs: JSON.stringify({ session_id: 42 }),
        })}
      />,
    );

    expect(screen.getByText("session")).toBeInTheDocument();
    expect(screen.getByText("Reading conversation")).toBeInTheDocument();
    expect(screen.getByText("Session #42")).toBeInTheDocument();
  });
});
