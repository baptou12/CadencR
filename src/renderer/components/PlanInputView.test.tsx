import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PlanInputView } from "./PlanInputView";

const defaultProps = {
  description: "",
  onDescriptionChange: vi.fn(),
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
      screen.getByPlaceholderText(/describe the feature/i)
    ).toBeInTheDocument();
  });

  it("renders Start Planning button (disabled when description empty)", () => {
    render(<PlanInputView {...defaultProps} description="" />);
    expect(screen.getByRole("button", { name: /start planning/i })).toBeDisabled();
  });

  it("enables Start Planning button when description has content", () => {
    render(<PlanInputView {...defaultProps} description="Add auth" />);
    expect(screen.getByRole("button", { name: /start planning/i })).not.toBeDisabled();
  });

  it("calls onDescriptionChange on input", async () => {
    const onChange = vi.fn();
    const { user } = render(
      <PlanInputView {...defaultProps} onDescriptionChange={onChange} />
    );
    await user.type(screen.getByRole("textbox"), "new feature");
    expect(onChange).toHaveBeenCalled();
  });

  it("calls onStartPlanning on button click", async () => {
    const onStartPlanning = vi.fn();
    const { user } = render(
      <PlanInputView
        {...defaultProps}
        description="Build feature"
        onStartPlanning={onStartPlanning}
      />
    );
    await user.click(screen.getByRole("button", { name: /start planning/i }));
    expect(onStartPlanning).toHaveBeenCalledOnce();
  });

  it("calls onStartBrainstorming on button click", async () => {
    const onStartBrainstorming = vi.fn();
    const { user } = render(
      <PlanInputView
        {...defaultProps}
        description="Explore idea"
        onStartBrainstorming={onStartBrainstorming}
      />
    );
    await user.click(screen.getByRole("button", { name: /start brainstorming/i }));
    expect(onStartBrainstorming).toHaveBeenCalledOnce();
  });

  it("disables buttons when isStartingPlan is true", () => {
    render(<PlanInputView {...defaultProps} description="Feature" isStartingPlan={true} />);
    expect(screen.getByRole("button", { name: /start planning/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /start brainstorming/i })).toBeDisabled();
  });
});
