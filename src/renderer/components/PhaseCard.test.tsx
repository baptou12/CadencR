import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PhaseCard } from "./PhaseCard";
import type { PhaseData } from "./PhaseCard";

function makePhase(overrides: Partial<PhaseData> = {}): PhaseData {
  return {
    id: 1,
    plan_id: 1,
    step_number: 1,
    title: "Test Phase",
    status: "pending",
    complexity: null,
    commit_message: null,
    prompt: null,
    order_index: 0,
    implementation_notes: null,
    deviations: null,
    phase_type: "normal",
    ...overrides,
  };
}

describe("PhaseCard", () => {
  it("renders phase title", () => {
    render(
      <PhaseCard
        phase={makePhase({ title: "My Phase" })}
        displayNumber={1}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText("My Phase")).toBeInTheDocument();
  });

  it("renders display number", () => {
    render(
      <PhaseCard
        phase={makePhase()}
        displayNumber={3}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText("Phase 3")).toBeInTheDocument();
  });

  it("shows QA badge for qa phase_type", () => {
    render(
      <PhaseCard
        phase={makePhase({ phase_type: "qa" })}
        displayNumber={1}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText("QA")).toBeInTheDocument();
  });

  it("shows Setup badge for setup phase_type", () => {
    render(
      <PhaseCard
        phase={makePhase({ phase_type: "setup" })}
        displayNumber={1}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText("Setup")).toBeInTheDocument();
  });

  it("calls onExpand when expand button clicked", async () => {
    const onExpand = vi.fn();
    const phase = makePhase();
    const { user } = render(
      <PhaseCard phase={phase} displayNumber={1} onExpand={onExpand} />
    );
    await user.click(screen.getByTitle("Expand phase"));
    expect(onExpand).toHaveBeenCalledWith(phase);
  });

  it("shows reset button when canReset is true", () => {
    render(
      <PhaseCard
        phase={makePhase({ status: "completed" })}
        displayNumber={1}
        onExpand={vi.fn()}
        canReset={true}
        onReset={vi.fn()}
      />
    );
    expect(screen.getByTitle("Reset phase to pending")).toBeInTheDocument();
  });

  it("calls onReset when reset button clicked", async () => {
    const onReset = vi.fn();
    const phase = makePhase({ status: "completed" });
    const { user } = render(
      <PhaseCard
        phase={phase}
        displayNumber={1}
        onExpand={vi.fn()}
        canReset={true}
        onReset={onReset}
      />
    );
    await user.click(screen.getByTitle("Reset phase to pending"));
    expect(onReset).toHaveBeenCalledWith(phase);
  });
});
