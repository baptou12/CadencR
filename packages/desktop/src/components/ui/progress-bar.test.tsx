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
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
  });

  it("returns null when total is 0", () => {
    const { container } = render(<ProgressBar completed={0} total={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("applies custom className", () => {
    const { container } = render(<ProgressBar completed={1} total={2} className="mt-4" />);
    expect(container.firstChild).toHaveClass("mt-4");
  });

  it("can hide the count and clamp invalid display values", () => {
    render(<ProgressBar completed={12} total={10} showCount={false} aria-label="Optimizing" />);

    expect(screen.queryByText("10/10")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Optimizing" })).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });
});
