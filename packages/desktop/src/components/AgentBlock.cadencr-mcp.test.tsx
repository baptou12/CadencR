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

describe("AgentBlock Cadencr MCP browser tools", () => {
  it("renders a browser_open_url MCP call with custom styling", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr-browser__browser_open_url",
          toolArgs: JSON.stringify({ url: "http://localhost:5173" }),
        })}
      />,
    );

    expect(screen.getByText("browser")).toBeInTheDocument();
    expect(screen.getByText("Opening URL")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:5173")).toBeInTheDocument();
  });

  it("renders a Codex namespace MCP call with custom styling", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr_browser____browser_screenshot",
          toolArgs: JSON.stringify({ tab_id: "tab-42" }),
        })}
      />,
    );

    expect(screen.getByText("browser")).toBeInTheDocument();
    expect(screen.getByText("Taking screenshot")).toBeInTheDocument();
    expect(screen.getByText("Tab tab-42")).toBeInTheDocument();
  });
});
