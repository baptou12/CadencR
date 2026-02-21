import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { AgentStream } from "./AgentStream";
import type { AgentBlockData } from "./AgentBlock";

// Mock AgentBlock to keep tests focused on AgentStream behavior
vi.mock("./AgentBlock", () => ({
  AgentBlock: ({ block }: { block: AgentBlockData }) => (
    <div data-testid={`block-${block.id}`}>{block.content}</div>
  ),
}));

function makeBlock(id: string, content: string, type: AgentBlockData["type"] = "text"): AgentBlockData {
  return { id, type, content };
}

describe("AgentStream", () => {
  it("renders blocks", () => {
    render(
      <AgentStream
        blocks={[makeBlock("1", "Hello"), makeBlock("2", "World")]}
      />,
    );
    expect(screen.getByTestId("block-1")).toBeInTheDocument();
    expect(screen.getByTestId("block-2")).toBeInTheDocument();
  });

  it("renders empty stream without crashing", () => {
    const { container } = render(<AgentStream blocks={[]} />);
    expect(container).toBeInTheDocument();
  });

  it("shows streaming indicator when isStreaming is true", () => {
    render(
      <AgentStream
        blocks={[makeBlock("1", "Some output", "tool_call")]}
        isStreaming
      />,
    );
    // The streaming indicator shows the last tool name + "..."
    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
  });

  it("shows 'Generating...' when no tool calls and streaming", () => {
    render(<AgentStream blocks={[]} isStreaming />);
    expect(screen.getByText("Generating...")).toBeInTheDocument();
  });

  it("does not show streaming indicator when not streaming", () => {
    render(
      <AgentStream
        blocks={[makeBlock("1", "Done output")]}
        isStreaming={false}
      />,
    );
    expect(screen.queryByText(/\.\.\./)).not.toBeInTheDocument();
  });

  it("filters out blocks with parentToolUseId", () => {
    const parentBlock = makeBlock("1", "Parent");
    const childBlock: AgentBlockData = {
      ...makeBlock("2", "Child"),
      parentToolUseId: "parent-id",
    };
    render(<AgentStream blocks={[parentBlock, childBlock]} />);
    expect(screen.getByTestId("block-1")).toBeInTheDocument();
    expect(screen.queryByTestId("block-2")).not.toBeInTheDocument();
  });
});
