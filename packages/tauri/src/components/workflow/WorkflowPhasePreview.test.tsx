import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { WorkflowPhasePreview } from "./WorkflowPhasePreview";
import type { WorkflowPhase } from "@/api/generated";

function makePhase(overrides: Partial<WorkflowPhase> & { name: string; order_index: number }): WorkflowPhase {
  return {
    id: overrides.order_index + 1,
    workflow_definition_id: 1,
    slug: overrides.name.toLowerCase(),
    gate_type: "auto",
    system_prompt_template: "",
    command_prompt_template: "",
    artifact_template: "",
    input_phase_slugs: [],
    model_override: "",
    agent_type: "workflow" as const,
    artifact_types: [],
    ...overrides,
  };
}

describe("WorkflowPhasePreview", () => {
  it("renders phase names in order_index order", () => {
    const phases = [
      makePhase({ name: "Build", order_index: 2 }),
      makePhase({ name: "PRD", order_index: 0 }),
      makePhase({ name: "Plan", order_index: 1 }),
    ];
    render(<WorkflowPhasePreview phases={phases} />);
    const items = screen.getAllByText(/PRD|Plan|Build/);
    expect(items.map((el) => el.textContent)).toEqual(["PRD", "Plan", "Build"]);
  });

  it("renders a separator between phases", () => {
    const phases = [
      makePhase({ name: "PRD", order_index: 0 }),
      makePhase({ name: "Plan", order_index: 1 }),
    ];
    const { container } = render(<WorkflowPhasePreview phases={phases} />);
    expect(container.textContent).toContain("›");
  });

  it("renders no separator for a single phase", () => {
    const phases = [makePhase({ name: "Plan", order_index: 0 })];
    const { container } = render(<WorkflowPhasePreview phases={phases} />);
    expect(container.textContent).not.toContain("›");
  });

  it("applies custom className", () => {
    const phases = [makePhase({ name: "Plan", order_index: 0 })];
    const { container } = render(<WorkflowPhasePreview phases={phases} className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("renders empty without crashing", () => {
    const { container } = render(<WorkflowPhasePreview phases={[]} />);
    expect(container.firstChild).toBeTruthy();
  });
});
