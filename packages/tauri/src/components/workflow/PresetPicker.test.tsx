import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import type { WorkflowDefinition } from "@/api/generated";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDefinitions: WorkflowDefinition[] = [
  {
    id: 1,
    name: "Cadence Default",
    slug: "cadence-default",
    description: "The default workflow",
    is_preset: true,
    phases: [
      { id: 1, workflow_definition_id: 1, name: "Plan", slug: "plan", order_index: 0, gate_type: "auto", system_prompt_template: "", command_prompt_template: "", artifact_template: "", input_phase_slugs: [], model_override: "", agent_type: "workflow" as const, artifact_types: [], max_iterations: 1 },
    ],
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
  },
  {
    id: 2,
    name: "Speckit",
    slug: "speckit",
    description: "Speckit workflow",
    is_preset: true,
    phases: [
      { id: 2, workflow_definition_id: 2, name: "Spec", slug: "spec", order_index: 0, gate_type: "approval", system_prompt_template: "", command_prompt_template: "", artifact_template: "", input_phase_slugs: [], model_override: "", agent_type: "workflow" as const, artifact_types: [], max_iterations: 1 },
      { id: 3, workflow_definition_id: 2, name: "Build", slug: "build", order_index: 1, gate_type: "auto", system_prompt_template: "", command_prompt_template: "", artifact_template: "", input_phase_slugs: ["spec"], model_override: "", agent_type: "workflow" as const, artifact_types: [], max_iterations: 1 },
    ],
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
  },
];

let mockIsLoading = false;
let mockData: WorkflowDefinition[] | undefined = mockDefinitions;

vi.mock("@/api/generated", () => ({
  useListWorkflowDefinitions: () => ({ data: mockData, isLoading: mockIsLoading }),
}));

vi.mock("./WorkflowPhasePreview", () => ({
  WorkflowPhasePreview: () => <div data-testid="phase-preview" />,
}));

// Import after mocks
import { PresetPicker } from "./PresetPicker";

describe("PresetPicker", () => {
  beforeEach(() => {
    mockIsLoading = false;
    mockData = mockDefinitions;
  });

  it("renders preset cards from definitions", () => {
    render(<PresetPicker onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByText("Cadence Default")).toBeInTheDocument();
    expect(screen.getByText("Speckit")).toBeInTheDocument();
  });

  it("renders legacy card", () => {
    render(<PresetPicker onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByText("Classic (Plan → PRD → Build)")).toBeInTheDocument();
  });

  it("calls onSelect with definition id when card clicked", async () => {
    const onSelect = vi.fn();
    const { user } = render(<PresetPicker onSelect={onSelect} selectedId={null} />);
    await user.click(screen.getByText("Speckit"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("calls onSelect(null) when legacy card clicked", async () => {
    const onSelect = vi.fn();
    const { user } = render(<PresetPicker onSelect={onSelect} selectedId={null} />);
    await user.click(screen.getByText("Classic (Plan → PRD → Build)"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("shows loading skeletons when loading", () => {
    mockIsLoading = true;
    mockData = undefined;
    const { container } = render(<PresetPicker onSelect={vi.fn()} selectedId={null} />);
    // Skeleton elements should be present (3 skeleton cards)
    const skeletons = container.querySelectorAll("[class*='animate-pulse'], [data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows phase count badge", () => {
    render(<PresetPicker onSelect={vi.fn()} selectedId={null} />);
    expect(screen.getByText("1 phases")).toBeInTheDocument();
    expect(screen.getByText("2 phases")).toBeInTheDocument();
  });
});
