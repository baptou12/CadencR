import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { NextStepsBar } from "./NextStepsBar";

const defaultProps = {
  show: true,
  canStartBuild: true,
  canStartRisk: false,
  canStartReview: false,
  executeStatus: "idle" as const,
  onStartBuilding: vi.fn(),
  onStartRisk: vi.fn(),
  onStartReview: vi.fn(),
  isStartingExecute: false,
  isStartingRisk: false,
  isStartingReview: false,
};

describe("NextStepsBar", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(<NextStepsBar {...defaultProps} show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Next Steps heading", () => {
    render(<NextStepsBar {...defaultProps} />);
    expect(screen.getByText("Next Steps")).toBeInTheDocument();
  });

  it("renders Start Building button when canStartBuild", () => {
    render(<NextStepsBar {...defaultProps} canStartBuild={true} />);
    expect(screen.getByRole("button", { name: /start building/i })).toBeInTheDocument();
  });

  it("calls onStartBuilding when button clicked", async () => {
    const onStartBuilding = vi.fn();
    const { user } = render(
      <NextStepsBar {...defaultProps} onStartBuilding={onStartBuilding} />
    );
    await user.click(screen.getByRole("button", { name: /start building/i }));
    expect(onStartBuilding).toHaveBeenCalledOnce();
  });

  it("renders Evaluate Risk button when canStartRisk", () => {
    render(<NextStepsBar {...defaultProps} canStartBuild={false} canStartRisk={true} />);
    expect(screen.getByRole("button", { name: /evaluate risk/i })).toBeInTheDocument();
  });

  it("renders Start Review button when canStartReview", () => {
    render(<NextStepsBar {...defaultProps} canStartBuild={false} canStartReview={true} />);
    expect(screen.getByRole("button", { name: /start review/i })).toBeInTheDocument();
  });

  it("renders Continue Building button when canContinueBuild", () => {
    render(
      <NextStepsBar
        {...defaultProps}
        canStartBuild={false}
        canContinueBuild={true}
        onContinueBuild={vi.fn()}
        nextStepNumber={3}
      />
    );
    expect(screen.getByRole("button", { name: /continue to step 3/i })).toBeInTheDocument();
  });

  it("disables buttons when loading", () => {
    render(<NextStepsBar {...defaultProps} isStartingExecute={true} />);
    expect(screen.getByRole("button", { name: /start building/i })).toBeDisabled();
  });

  it("shows retry build text on error status", () => {
    render(<NextStepsBar {...defaultProps} executeStatus="error" />);
    expect(screen.getByRole("button", { name: /retry build/i })).toBeInTheDocument();
  });
});
