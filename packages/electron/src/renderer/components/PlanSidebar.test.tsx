import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PlanSidebar } from "./PlanSidebar";
import React from "react";

const mockPhases = [
  {
    id: 10, plan_id: 1, step_number: 1, title: "Phase Alpha",
    status: "pending", complexity: null, commit_message: null,
    prompt: "Do some work", order_index: 0,
    implementation_notes: null, deviations: null, phase_type: "normal",
  },
  {
    id: 11, plan_id: 1, step_number: 2, title: "Phase Beta",
    status: "completed", complexity: 3, commit_message: "feat: add beta",
    prompt: "More work", order_index: 1,
    implementation_notes: "Done", deviations: null, phase_type: "normal",
  },
];

const { mockGetPlan, mockResetPhase } = vi.hoisted(() => ({
  mockGetPlan: vi.fn<() => { data: unknown }>(() => ({
    data: { id: 1, title: "My Plan", phases: mockPhases },
  })),
  mockResetPhase: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useGetFeaturePlan: mockGetPlan,
  useGetFeaturePrd: vi.fn(() => ({ data: null })),
  useResetPhase: vi.fn(() => ({ mutate: mockResetPhase, isLoading: false })),
  useOverridePhaseStatus: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  getGetFeaturePlanQueryKey: vi.fn((id: number) => ["features", "plan", id]),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    createClient: vi.fn(() => ({})),
    Provider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useUtils: vi.fn(() => ({
      agents: { getFeatureAgentState: { invalidate: vi.fn() } },
    })),
  },
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));

describe("PlanSidebar", () => {
  it("renders plan title", () => {
    render(<PlanSidebar featureId={1} />);
    expect(screen.getByText("My Plan")).toBeInTheDocument();
  });

  it("renders phase titles", () => {
    render(<PlanSidebar featureId={1} />);
    expect(screen.getByText("Phase Alpha")).toBeInTheDocument();
    expect(screen.getByText("Phase Beta")).toBeInTheDocument();
  });

  it("renders nothing when plan is null", () => {
    mockGetPlan.mockReturnValueOnce({ data: null });
    const { container } = render(<PlanSidebar featureId={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("expands phase on expand click", async () => {
    const { user } = render(<PlanSidebar featureId={1} />);
    await user.click(screen.getByText("Phase Alpha"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
