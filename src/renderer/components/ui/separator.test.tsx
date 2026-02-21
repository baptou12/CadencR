import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { Separator } from "./separator";

describe("Separator", () => {
  it("renders a horizontal separator by default", () => {
    render(<Separator />);
    const sep = screen.getByRole("none", { hidden: true });
    expect(sep).toBeInTheDocument();
    expect(sep).toHaveAttribute("data-orientation", "horizontal");
  });

  it("renders a vertical separator", () => {
    render(<Separator orientation="vertical" />);
    const sep = screen.getByRole("none", { hidden: true });
    expect(sep).toHaveAttribute("data-orientation", "vertical");
  });

  it("applies custom className", () => {
    render(<Separator className="my-sep" />);
    const sep = screen.getByRole("none", { hidden: true });
    expect(sep).toHaveClass("my-sep");
  });
});
