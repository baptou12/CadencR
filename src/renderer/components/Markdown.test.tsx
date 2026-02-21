import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
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

  it("renders fenced code block with language", () => {
    render(<Markdown content={"```typescript\nconst x = 1;\n```"} />);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <Markdown content="text" className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("preprocesses PLAN_START/PLAN_END markers", () => {
    render(<Markdown content="---PLAN_START---\nPlan content\n---PLAN_END---" />);
    expect(screen.getByText("Plan content")).toBeInTheDocument();
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
