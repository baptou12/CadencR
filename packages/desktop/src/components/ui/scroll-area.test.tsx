import { describe, it, expect } from "vitest";
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
});
