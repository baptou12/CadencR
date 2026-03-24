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

  it("shows streaming cursor when isStreaming is true", () => {
    render(
      <AgentStream
        blocks={[makeBlock("1", "Some output", "tool_call")]}
        isStreaming
      />,
    );
    expect(screen.getByText("█")).toBeInTheDocument();
  });

  it("shows cursor when streaming with no blocks", () => {
    render(<AgentStream blocks={[]} isStreaming />);
    expect(screen.getByText("█")).toBeInTheDocument();
  });

  it("renders sender and timestamp header for text blocks", () => {
    const block: AgentBlockData = {
      ...makeBlock("1", "Hello"),
      createdAt: "2026-02-22T10:30:00Z",
      model: "claude-sonnet-4-6",
    };
    render(<AgentStream blocks={[block]} />);
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("renders 'User' header for user_message blocks", () => {
    const block: AgentBlockData = {
      ...makeBlock("1", "Hi there", "user_message"),
      createdAt: "2026-02-22T10:30:00Z",
    };
    render(<AgentStream blocks={[block]} />);
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("renders 'unknown' when model is not set", () => {
    const block: AgentBlockData = {
      ...makeBlock("1", "Hello"),
      createdAt: "2026-02-22T10:30:00Z",
    };
    render(<AgentStream blocks={[block]} />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
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
