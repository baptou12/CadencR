import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { AgentStream } from "./AgentStream";
import type { AgentBlockData } from "./AgentBlock";

// Mock Virtuoso so JSDOM tests render all items synchronously without
// requiring layout/IntersectionObserver. We don't need true virtualization
// here — just that the data is flushed through `itemContent` and that
// Header/Footer slots are honoured.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
    components,
  }: {
    data: AgentBlockData[];
    itemContent: (index: number, block: AgentBlockData) => ReactNode;
    components?: {
      Header?: () => ReactNode;
      Footer?: () => ReactNode;
    };
  }) => (
    <div data-testid="virtuoso">
      {components?.Header ? <components.Header /> : null}
      {data.map((item, i) => (
        <div key={item.id} data-testid={`virtuoso-item-${item.id}`}>
          {itemContent(i, item)}
        </div>
      ))}
      {components?.Footer ? <components.Footer /> : null}
    </div>
  ),
}));

// Mock AgentBlock to keep tests focused on AgentStream behavior
vi.mock("./AgentBlock", async () => {
  const actual = await vi.importActual<typeof import("./AgentBlock")>("./AgentBlock");
  return {
    ...actual,
    AgentBlock: ({ block }: { block: AgentBlockData }) => (
      <div data-testid={`block-${block.id}`}>{block.content}</div>
    ),
  };
});

function makeBlock(
  id: string,
  content: string,
  type: AgentBlockData["type"] = "text",
): AgentBlockData {
  return { id, type, content };
}

describe("AgentStream", () => {
  it("renders blocks", () => {
    render(<AgentStream blocks={[makeBlock("1", "Hello"), makeBlock("2", "World")]} />);
    expect(screen.getByTestId("block-1")).toBeInTheDocument();
    expect(screen.getByTestId("block-2")).toBeInTheDocument();
  });

  it("renders empty stream without crashing", () => {
    const { container } = render(<AgentStream blocks={[]} />);
    expect(container).toBeInTheDocument();
  });

  it("shows streaming cursor when isStreaming is true", () => {
    render(<AgentStream blocks={[makeBlock("1", "Some output", "tool_call")]} isStreaming />);
    expect(screen.getByText("█")).toBeInTheDocument();
  });

  it("shows cursor when streaming with no blocks", () => {
    render(<AgentStream blocks={[]} isStreaming />);
    expect(screen.getByText("█")).toBeInTheDocument();
  });

  it("hides streaming cursor when disabled by loader style", () => {
    render(<AgentStream blocks={[]} isStreaming showStreamingIndicator={false} />);
    expect(screen.queryByText("█")).not.toBeInTheDocument();
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
    render(<AgentStream blocks={[makeBlock("1", "Done output")]} isStreaming={false} />);
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

  it("coalesces persisted text chunks split by hidden blocks", () => {
    const createdAt = "2026-04-12T12:09:36Z";
    const blocks: AgentBlockData[] = [
      { ...makeBlock("1", "Hello "), createdAt, model: "openai/gpt-5.3-codex" },
      { ...makeBlock("2", "ignored", "tool_result"), sourceToolName: "Read" },
      { ...makeBlock("3", "world"), createdAt, model: "openai/gpt-5.3-codex" },
    ];
    render(<AgentStream blocks={blocks} />);
    expect(screen.getByTestId("block-1")).toHaveTextContent("Hello world");
    expect(screen.queryByTestId("block-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("block-3")).not.toBeInTheDocument();
  });

  it("renders the loading-older spinner via Virtuoso Header when isLoadingOlder is true", () => {
    const { container } = render(<AgentStream blocks={[makeBlock("1", "Hello")]} isLoadingOlder />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
