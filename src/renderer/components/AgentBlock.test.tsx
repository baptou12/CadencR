import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentBlock } from "./AgentBlock";
import type { AgentBlockData } from "./AgentBlock";

// Mock InlineDiffBlock to avoid complex diff rendering
vi.mock("./InlineDiffBlock", () => ({
  InlineDiffBlock: ({ filePath }: { filePath: string }) => (
    <div data-testid="inline-diff">{filePath}</div>
  ),
}));

vi.mock("@/components/ui/collapsible-block", () => ({
  CollapsibleBlock: ({
    children,
    header,
  }: {
    children: ({ showAll }: { showAll: boolean }) => React.ReactNode;
    header: React.ReactNode;
    totalCount: number;
    visibleCount: number;
  }) => (
    <div>
      <div>{header}</div>
      <div>{children({ showAll: false })}</div>
    </div>
  ),
}));

function makeBlock(overrides: Partial<AgentBlockData>): AgentBlockData {
  return {
    id: "block-1",
    type: "text",
    content: "Default content",
    ...overrides,
  };
}

describe("AgentBlock", () => {
  describe("text block", () => {
    it("renders text content via Markdown", () => {
      render(<AgentBlock block={makeBlock({ type: "text", content: "Hello world" })} />);
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });
  });

  describe("code block", () => {
    it("renders code with language label", () => {
      render(
        <AgentBlock
          block={makeBlock({ type: "code", content: "const x = 1;", language: "typescript" })}
        />,
      );
      expect(screen.getByText("typescript")).toBeInTheDocument();
      expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    });

    it("renders code without language", () => {
      render(
        <AgentBlock block={makeBlock({ type: "code", content: "some code" })} />,
      );
      expect(screen.getByText("some code")).toBeInTheDocument();
    });
  });

  describe("tool_call block", () => {
    it("renders a tool call button", () => {
      render(
        <AgentBlock
          block={makeBlock({
            type: "tool_call",
            toolName: "Bash",
            toolArgs: JSON.stringify({ command: "ls -la" }),
          })}
        />,
      );
      expect(screen.getByText("Bash")).toBeInTheDocument();
    });

    it("expands tool args on click", async () => {
      const user = userEvent.setup();
      render(
        <AgentBlock
          block={makeBlock({
            type: "tool_call",
            toolName: "Bash",
            toolArgs: JSON.stringify({ command: "ls -la" }),
          })}
        />,
      );
      const buttons = screen.getAllByRole("button");
      await user.click(buttons[0]);
      expect(screen.getAllByText(/ls -la/).length).toBeGreaterThan(0);
    });

    it("returns null for TodoWrite tool", () => {
      const { container } = render(
        <AgentBlock block={makeBlock({ type: "tool_call", toolName: "TodoWrite" })} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders Write tool with InlineDiffBlock", () => {
      render(
        <AgentBlock
          block={makeBlock({
            type: "tool_call",
            toolName: "Write",
            toolArgs: JSON.stringify({ file_path: "src/foo.ts", content: "new content" }),
          })}
        />,
      );
      expect(screen.getByTestId("inline-diff")).toBeInTheDocument();
    });

    it("renders thinking block", () => {
      render(
        <AgentBlock
          block={makeBlock({ type: "thinking", content: "I am thinking..." })}
        />,
      );
      expect(screen.getByText("Thinking")).toBeInTheDocument();
    });
  });

  describe("user_message block", () => {
    it("renders user message content", () => {
      render(
        <AgentBlock
          block={makeBlock({ type: "user_message", content: "User said this" })}
        />,
      );
      expect(screen.getByText("User said this")).toBeInTheDocument();
    });
  });

  describe("compact_divider block", () => {
    it("renders compacted divider", () => {
      render(
        <AgentBlock block={makeBlock({ type: "compact_divider", content: "" })} />,
      );
      expect(screen.getByText("Compacted")).toBeInTheDocument();
    });
  });

  describe("tool_result block", () => {
    it("returns null for generic tool_result", () => {
      const { container } = render(
        <AgentBlock
          block={makeBlock({
            type: "tool_result",
            content: "some result",
            sourceToolName: "Grep",
          })}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders Bash output", () => {
      render(
        <AgentBlock
          block={makeBlock({
            type: "tool_result",
            content: "line1\nline2",
            sourceToolName: "Bash",
          })}
        />,
      );
      expect(screen.getByText(/Output/)).toBeInTheDocument();
    });
  });
});
