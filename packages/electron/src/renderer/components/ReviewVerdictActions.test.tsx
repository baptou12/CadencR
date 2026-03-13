import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ReviewVerdictActions } from "./ReviewVerdictActions";

describe("ReviewVerdictActions", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(
      <ReviewVerdictActions
        show={false}
        reviewVerdict="changes_requested"
        onAddFixPhase={vi.fn()}
        onFixImmediately={vi.fn()}
        isAddingFixPhase={false}
        isStartingFix={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when reviewVerdict is null", () => {
    const { container } = render(
      <ReviewVerdictActions
        show={true}
        reviewVerdict={null}
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

  it("calls onAddFixPhase when button clicked", async () => {
    const onAddFixPhase = vi.fn();
    const { user } = render(
      <ReviewVerdictActions
        show={true}
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
