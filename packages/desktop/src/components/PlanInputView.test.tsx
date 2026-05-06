import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PlanInputView } from "./PlanInputView";

vi.mock("@/api/agentRuntime", () => ({
  useAgentCatalog: vi.fn(() => ({
    data: {
      default_provider: "claude_code",
      providers: [
        {
          id: "claude_code",
          label: "Claude Code",
          status: "available",
          models: [{ id: "opus", label: "Opus" }],
          default_model: "opus",
        },
      ],
    },
    isLoading: false,
  })),
}));

vi.mock("@/hooks/useResolvedModel", () => ({
  useResolvedModel: vi.fn(() => ({
    resolveProvider: vi.fn(() => "claude_code"),
    resolveModel: vi.fn(() => "opus"),
    resolveModelThinkingEffort: vi.fn(() => undefined),
    setModelThinkingEffort: vi.fn(),
    handleProviderChange: vi.fn(),
    handleModelChange: vi.fn(),
  })),
}));

vi.mock("@/api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/generated")>()),
  useListFiles: vi.fn(() => ({ data: [] })),
}));

const defaultProps = {
  featureId: 1,
  projectId: 1,
  onStartPlanning: vi.fn(),
  onStartPrd: vi.fn(),
  isStartingPlan: false,
  isStartingPrd: false,
};

describe("PlanInputView", () => {
  it("renders heading", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Start Planning" })).toBeInTheDocument();
  });

  it("renders editor with placeholder text", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByText(/send a message/i)).toBeInTheDocument();
  });

  it("renders Plan button", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /plan/i })).toBeInTheDocument();
  });

  it("renders PRD button", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /prd/i })).toBeInTheDocument();
  });

  it("renders a model picker chip above the prompt", () => {
    render(<PlanInputView {...defaultProps} />);
    expect(screen.getByRole("button", { name: /opus/i })).toBeInTheDocument();
  });
});
