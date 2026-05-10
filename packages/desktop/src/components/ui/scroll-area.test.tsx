import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@/test-utils";
import { ScrollArea } from "./scroll-area";

describe("ScrollArea", () => {
  it("renders children", () => {
    render(
      <ScrollArea>
        <div>Scrollable content</div>
      </ScrollArea>,
    );
    expect(screen.getByText("Scrollable content")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <ScrollArea className="my-scroll">
        <div>Content</div>
      </ScrollArea>,
    );
    expect(container.querySelector("[data-slot='scroll-area']")).toHaveClass("my-scroll");
  });

  it("does not reveal the scrollbar just because the scroll area is hovered", () => {
    const source = readFileSync(join(process.cwd(), "src/components/ui/scroll-area.tsx"), "utf8");
    expect(source).toContain("data-[state=visible]:opacity-100");
    expect(source).not.toContain("[[data-slot=scroll-area]:hover_&]:opacity-100");
  });
});
