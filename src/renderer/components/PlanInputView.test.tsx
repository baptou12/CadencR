import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PlanInputView } from "./PlanInputView";

const defaultProps = {
  onStartPlanning: vi.fn(),
  onStartBrainstorming: vi.fn(),
  isStartingPlan: false,
  isStartingBrainstorm: false,
};

describe("PlanInputView", () => {
  it("renders heading", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Start Planning" })).toBeInTheDocument();
  });

  it("renders textarea with placeholder", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(/send a message/i)
    ).toBeInTheDocument();
  });

  it("renders Plan button", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /plan/i })).toBeInTheDocument();
  });

  it("renders Brainstorm button", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /brainstorm/i })).toBeInTheDocument();
  });
});
