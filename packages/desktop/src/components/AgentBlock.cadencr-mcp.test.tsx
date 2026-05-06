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

describe("AgentBlock Cadencr MCP plan tools", () => {
  it("renders a show_plan MCP call with custom styling before content is attached", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr-plan__show_plan",
          toolArgs: JSON.stringify({ plan_id: 1 }),
        })}
      />,
    );

    expect(screen.getByText("plan")).toBeInTheDocument();
    expect(screen.getByText("Showing plan")).toBeInTheDocument();
  });

  it("renders a Codex namespace MCP call with custom styling", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr_plan____read_plan",
          toolArgs: JSON.stringify({ feature_id: 1086 }),
        })}
      />,
    );

    expect(screen.getByText("plan")).toBeInTheDocument();
    expect(screen.getByText("Reading plan")).toBeInTheDocument();
  });

  it("renders attached show_plan content as the visible plan", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr-plan__show_plan",
          toolArgs: JSON.stringify({ plan: "# Build Plan" }),
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Build Plan" })).toBeInTheDocument();
  });

  it("renders attached show_prd content as the visible PRD", () => {
    render(
      <AgentBlock
        block={makeBlock({
          toolName: "mcp__cadencr-prd__show_prd",
          toolArgs: JSON.stringify({ plan: "# Product Requirements" }),
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Product Requirements" }),
    ).toBeInTheDocument();
  });
});
