import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import type { WorkflowDefinition, WorkflowPhase } from "@/api/generated";
import type { PhaseStatus } from "@/types/workflow";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makePhase = (overrides: Partial<WorkflowPhase> = {}): WorkflowPhase => ({
  id: 1,
  workflow_definition_id: 1,
  name: "Planning",
  slug: "planning",
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

const mockPhases: WorkflowPhase[] = [
  makePhase({ id: 1, name: "Planning", slug: "planning", order_index: 0, gate_type: "auto" }),
  makePhase({ id: 2, name: "Review", slug: "review", order_index: 1, gate_type: "approval" }),
  makePhase({ id: 3, name: "Execute", slug: "execute", order_index: 2, gate_type: "manual" }),
];

const mockDefinition: WorkflowDefinition = {
  id: 1,
  name: "Test Workflow",
  slug: "test-workflow",
  description: null,
  is_preset: false,
  phases: mockPhases,
  created_at: "2025-01-01",
  updated_at: "2025-01-01",
};

const mockPhaseStates = new Map<string, { status: PhaseStatus; artifactPreview: string | null; agentSessionId: number | null }>();
const mockApprovePhase = vi.fn();
const mockTriggerPhase = vi.fn();

vi.mock("@/api/generated", () => ({
  useGetWorkflowDefinition: () => ({ data: mockDefinition, isLoading: false }),
}));

vi.mock("@/hooks/useWorkflowWebSocket", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      phaseStates: mockPhaseStates,
      approvePhase: mockApprovePhase,
      triggerPhase: mockTriggerPhase,
    }),
}));

import { WorkflowQueueSidebar } from "./WorkflowQueueSidebar";

describe("WorkflowQueueSidebar", () => {
  beforeEach(() => {
    mockPhaseStates.clear();
    vi.clearAllMocks();
  });

  it("renders phase names", () => {
    render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Execute")).toBeInTheDocument();
  });

  it("renders workflow name in header", () => {
    render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    expect(screen.getByText("Test Workflow")).toBeInTheDocument();
  });

  it("shows gate type badges", () => {
    render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("Approval")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("shows approval button for pending_approval phases", () => {
    mockPhaseStates.set("review", { status: "pending_approval", artifactPreview: null, agentSessionId: null });
    render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    expect(screen.getByText("Review & Approve")).toBeInTheDocument();
  });

  it("shows start button for ready manual-gate phases", () => {
    mockPhaseStates.set("execute", { status: "ready", artifactPreview: null, agentSessionId: null });
    render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    expect(screen.getByText("Start Phase")).toBeInTheDocument();
  });

  it("does not show start button for ready auto-gate phases", () => {
    mockPhaseStates.set("planning", { status: "ready", artifactPreview: null, agentSessionId: null });
    render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    expect(screen.queryByText("Start Phase")).not.toBeInTheDocument();
  });

  it("calls approvePhase when approval button clicked", async () => {
    mockPhaseStates.set("review", { status: "pending_approval", artifactPreview: null, agentSessionId: null });
    const { user } = render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    await user.click(screen.getByText("Review & Approve"));
    expect(mockApprovePhase).toHaveBeenCalledWith("review", true);
  });

  it("calls triggerPhase when start button clicked", async () => {
    mockPhaseStates.set("execute", { status: "ready", artifactPreview: null, agentSessionId: null });
    const { user } = render(<WorkflowQueueSidebar workflowDefinitionId={1} />);
    await user.click(screen.getByText("Start Phase"));
    expect(mockTriggerPhase).toHaveBeenCalledWith("execute");
  });
});
