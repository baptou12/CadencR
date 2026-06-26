import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { Markdown } from "./Markdown";

// Mock the lazy diagram so the heavy real `mermaid` module is never pulled into
// jsdom; we only need to assert which branch the streaming gate takes.
vi.mock("@/components/MermaidDiagram", () => ({
  default: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

const MERMAID = "```mermaid\ngraph TD\n  A-->B\n```";

describe("Markdown mermaid streaming gate", () => {
  it("renders a diagram for a stable block (cacheKey set)", async () => {
    render(<Markdown content={MERMAID} cacheKey="stable-block" />);
    expect(await screen.findByTestId("mermaid-diagram")).toBeInTheDocument();
  });

  it("renders raw source while streaming (no cacheKey) instead of a diagram", () => {
    render(<Markdown content={MERMAID} />);
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    // Falls through to the normal code block: language label + source text.
    expect(screen.getByText("mermaid")).toBeInTheDocument();
    expect(screen.getByText(/graph TD/)).toBeInTheDocument();
  });
});
