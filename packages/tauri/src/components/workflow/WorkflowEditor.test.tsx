import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import type { WorkflowPhase } from "@/api/generated";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makePhase = (overrides: Partial<WorkflowPhase> = {}): WorkflowPhase => ({
  id: 1,
  workflow_definition_id: 1,
  name: "Phase 1",
  slug: "phase-1",
  order_index: 0,
  gate_type: "auto",
  system_prompt_template: "",
  command_prompt_template: "",
  artifact_template: "",
  input_phase_slugs: [],
  model_override: "",
  agent_type: "workflow",
  ...overrides,
});

const mockEditor = {
  isLoading: false,
  name: "My Workflow",
  slug: "my-workflow",
  description: "A test workflow",
  isPreset: false,
  phases: [
    makePhase({ id: 1, name: "Research", slug: "research", order_index: 0 }),
    makePhase({ id: 2, name: "Build", slug: "build", order_index: 1, gate_type: "approval" }),
  ],
  selectedPhaseId: null as number | null,
  selectedPhase: null as WorkflowPhase | null,
  activeTab: "system" as const,
  isMutating: false,
  handleNameChange: vi.fn(),
  handleSlugChange: vi.fn(),
  setDescription: vi.fn(),
  setSelectedPhaseId: vi.fn(),
  setActiveTab: vi.fn(),
  handleUpdatePhase: vi.fn(),
  handleDeletePhase: vi.fn(),
  handleReorder: vi.fn(),
  handleAddPhase: vi.fn(),
  handleSave: vi.fn(),
};

vi.mock("./useWorkflowEditor", () => ({
  useWorkflowEditor: () => mockEditor,
}));

vi.mock("./PhaseList", () => ({
  PhaseList: ({
    phases,
    onAdd,
    onDelete,
  }: {
    phases: WorkflowPhase[];
    onAdd: () => void;
    onDelete: (id: number) => void;
  }) => (
    <div data-testid="phase-list">
      {phases.map((p) => (
        <div key={p.id} data-testid={`phase-${p.slug}`}>
          {p.name}
          <button type="button" onClick={() => onDelete(p.id)}>Delete {p.name}</button>
        </div>
      ))}
      <button type="button" onClick={onAdd}>Add Phase</button>
    </div>
  ),
}));

vi.mock("./TemplateEditorPanel", () => ({
  TemplateEditorPanel: () => <div data-testid="template-editor" />,
}));

import { WorkflowEditor } from "./WorkflowEditor";

describe("WorkflowEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor.phases = [
      makePhase({ id: 1, name: "Research", slug: "research", order_index: 0 }),
      makePhase({ id: 2, name: "Build", slug: "build", order_index: 1, gate_type: "approval" }),
    ];
    mockEditor.isLoading = false;
    mockEditor.selectedPhase = null;
  });

  it("renders phase list from definition", () => {
    render(<WorkflowEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("renders workflow name input", () => {
    render(<WorkflowEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue("My Workflow")).toBeInTheDocument();
  });

  it("calls handleAddPhase when add button clicked", async () => {
    const { user } = render(<WorkflowEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByText("Add Phase"));
    expect(mockEditor.handleAddPhase).toHaveBeenCalledOnce();
  });

  it("calls handleDeletePhase when delete clicked", async () => {
    const { user } = render(<WorkflowEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByText("Delete Research"));
    expect(mockEditor.handleDeletePhase).toHaveBeenCalledWith(1);
  });

  it("shows loading spinner when loading", () => {
    mockEditor.isLoading = true;
    const { container } = render(<WorkflowEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows empty state when no phases and none selected", () => {
    mockEditor.phases = [];
    render(<WorkflowEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Add a phase to get started")).toBeInTheDocument();
  });

  it("calls onCancel when cancel button clicked", async () => {
    const onCancel = vi.fn();
    const { user } = render(<WorkflowEditor onSave={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
