import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("renders completed/total text", () => {
    render(<ProgressBar completed={3} total={10} />);
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("sets correct width percentage", () => {
    const { container } = render(<ProgressBar completed={5} total={10} />);
    const bar = container.querySelector("[style]");
    expect(bar).toHaveStyle({ width: "50%" });
  });

  it("returns null when total is 0", () => {
    const { container } = render(<ProgressBar completed={0} total={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("applies custom className", () => {
    const { container } = render(<ProgressBar completed={1} total={2} className="mt-4" />);
    expect(container.firstChild).toHaveClass("mt-4");
  });
});
