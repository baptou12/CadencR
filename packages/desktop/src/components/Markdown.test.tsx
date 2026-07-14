import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { LinkRoutingContext, type LinkRouting } from "./links/LinkRoutingContext";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders plain text content", () => {
    render(<Markdown content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders headings", () => {
    render(<Markdown content="# Heading 1" />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders h2 heading", () => {
    render(<Markdown content="## Heading 2" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("renders bold text", () => {
    render(<Markdown content="**bold text**" />);
    expect(screen.getByText("bold text")).toBeInTheDocument();
  });

  it("renders a link", () => {
    render(<Markdown content="[Click here](https://example.com)" />);
    const link = screen.getByRole("link", { name: "Click here" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("opens a serialized conversation reference when its full label is clicked", async () => {
    const activateConversation = vi.fn(async () => undefined);
    const routing: LinkRouting = {
      activate: vi.fn(),
      activateConversation,
      setHoverLink: vi.fn(),
    };
    const { user } = render(
      <LinkRoutingContext.Provider value={routing}>
        <Markdown content="Read [@@Cadencr / Prompt references](cadencr-conversation:feature/42)" />
      </LinkRoutingContext.Provider>,
    );

    const link = screen.getByRole("link", { name: "@@Cadencr / Prompt references" });
    expect(link).toHaveAttribute("href", "cadencr-conversation:feature/42");
    await user.click(link);
    expect(activateConversation).toHaveBeenCalledWith(42);
  });

  it("keeps serialized conversation references literal inside code", () => {
    const reference = "[@@Cadencr / Work](cadencr-conversation:feature/42)";
    render(<Markdown content={`\`${reference}\`\n\n\`\`\`text\n${reference}\n\`\`\``} />);
    expect(screen.queryByRole("link", { name: "@@Cadencr / Work" })).not.toBeInTheDocument();
    expect(screen.getAllByText(reference)).toHaveLength(2);
  });

  it("renders unordered list", () => {
    render(<Markdown content={"- item one\n- item two"} />);
    expect(screen.getByText("item one")).toBeInTheDocument();
    expect(screen.getByText("item two")).toBeInTheDocument();
  });

  it("renders ordered list", () => {
    render(<Markdown content={"1. first\n2. second"} />);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("renders inline code", () => {
    render(<Markdown content="Use `console.log()` to debug" />);
    expect(screen.getByText("console.log()")).toBeInTheDocument();
  });

  it("renders fenced code block with language and syntax highlighting", () => {
    render(<Markdown content={"```typescript\nconst x = 1;\n```"} />);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    // With syntax highlighting, "const x = 1;" is split across multiple spans
    const codeEl = document.querySelector("code.hljs");
    expect(codeEl).toBeInTheDocument();
    expect(codeEl?.textContent).toContain("const x = 1;");
  });

  it("renders fenced code block without language as a block with 'text' label", () => {
    render(<Markdown content={"```\nsome output\n```"} />);
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByText("some output")).toBeInTheDocument();
  });

  it("renders inline raw HTML", () => {
    render(<Markdown content={"Press <kbd>Ctrl</kbd> to continue"} />);
    const kbd = document.querySelector("kbd");
    expect(kbd).toBeInTheDocument();
    expect(kbd?.textContent).toBe("Ctrl");
  });

  it("renders block-level raw HTML", () => {
    render(<Markdown content={"<details><summary>More</summary><span>Hidden</span></details>"} />);
    expect(document.querySelector("details")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("strips dangerous HTML (script tags and event handlers)", () => {
    render(
      <Markdown
        content={'<img src="x" onerror="alert(1)" alt="pic"><script>alert(2)</script>Safe'}
      />,
    );
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(document.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(screen.getByText("Safe")).toBeInTheDocument();
  });

  it("strips javascript: URLs from raw HTML links", () => {
    render(<Markdown content={'<a href="javascript:alert(1)">click me</a>'} />);
    expect(screen.getByText("click me")).not.toHaveAttribute("href", "javascript:alert(1)");
  });

  it("applies custom className", () => {
    const { container } = render(<Markdown content="text" className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("preprocesses PLAN_START/PLAN_END markers", () => {
    render(<Markdown content="---PLAN_START---\nPlan content\n---PLAN_END---" />);
    expect(screen.getByText(/Plan content/)).toBeInTheDocument();
  });

  it("renders blockquote", () => {
    render(<Markdown content="> A quote" />);
    expect(screen.getByText("A quote")).toBeInTheDocument();
  });

  it("renders empty content without crashing", () => {
    const { container } = render(<Markdown content="" />);
    expect(container).toBeInTheDocument();
  });
});
