import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PlanInputView } from "./PlanInputView";

const defaultProps = {
  onStartPlanning: vi.fn(),
  onStartPrd: vi.fn(),
  isStartingPlan: false,
  isStartingPrd: false,
};

describe("PlanInputView", () => {
  it("renders heading", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Start Planning" })).toBeInTheDocument();
  });

  it("renders editor with placeholder text", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(
      screen.getByText(/send a message/i)
    ).toBeInTheDocument();
  });

  it("renders Plan button", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /plan/i })).toBeInTheDocument();
  });

  it("renders PRD button", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /prd/i })).toBeInTheDocument();
  });
});
