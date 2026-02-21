import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ReviewVerdictActions } from "./ReviewVerdictActions";

describe("ReviewVerdictActions", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(
      <ReviewVerdictActions
        show={false}
        reviewComplete={true}
        reviewVerdict="changes_requested"
        onAddFixPhase={vi.fn()}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={false}
        isStartingFix={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when reviewComplete is false", () => {
    const { container } = render(
      <ReviewVerdictActions
        show={true}
        reviewComplete={false}
        reviewVerdict="changes_requested"
        onAddFixPhase={vi.fn()}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={false}
        isStartingFix={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders fix buttons when changes_requested", () => {
    render(
      <ReviewVerdictActions
        show={true}
        reviewComplete={true}
        reviewVerdict="changes_requested"
        onAddFixPhase={vi.fn()}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={false}
        isStartingFix={false}
      />
    );
    expect(screen.getByRole("button", { name: /add fix phase/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fix immediately/i })).toBeInTheDocument();
  });

  it("renders approved message when verdict is approved", () => {
    render(
      <ReviewVerdictActions
        show={true}
        reviewComplete={true}
        reviewVerdict="approved"
        onAddFixPhase={vi.fn()}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={false}
        isStartingFix={false}
      />
    );
    expect(screen.getByText(/review approved/i)).toBeInTheDocument();
  });

  it("calls onAddFixPhase when button clicked", async () => {
    const onAddFixPhase = vi.fn();
    const { user } = render(
      <ReviewVerdictActions
        show={true}
        reviewComplete={true}
        reviewVerdict="changes_requested"
        onAddFixPhase={onAddFixPhase}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={false}
        isStartingFix={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /add fix phase/i }));
    expect(onAddFixPhase).toHaveBeenCalledOnce();
  });

  it("disables fix buttons when loading", () => {
    render(
      <ReviewVerdictActions
        show={true}
        reviewComplete={true}
        reviewVerdict="changes_requested"
        onAddFixPhase={vi.fn()}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={true}
        isStartingFix={true}
      />
    );
    expect(screen.getByRole("button", { name: /add fix phase/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /fix immediately/i })).toBeDisabled();
  });
});
