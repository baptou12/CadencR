import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ModelSelector } from "./ModelSelector";
import React from "react";

const { mockGetAvailableModels, mockGetGlobalSettings, mockGetProjectSettings, mockGetFeatureSettings } = vi.hoisted(() => ({
  mockGetAvailableModels: vi.fn(() => ({ data: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4", label: "Claude Sonnet 4" },
  ]})),
  mockGetGlobalSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetProjectSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetFeatureSettings: vi.fn(() => ({ data: {}, isLoading: false })),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    createClient: vi.fn(() => ({})),
    Provider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useUtils: vi.fn(() => ({
      workspace: { getModelSettings: { invalidate: vi.fn() } },
      projects: { getModelSettings: { invalidate: vi.fn() } },
      features: { getModelSettings: { invalidate: vi.fn() } },
    })),
    workspace: {
      getAvailableModels: { useQuery: mockGetAvailableModels },
      getModelSettings: { useQuery: mockGetGlobalSettings },
      setModelSetting: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
    projects: {
      getModelSettings: { useQuery: mockGetProjectSettings },
      setModelSetting: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
    features: {
      getModelSettings: { useQuery: mockGetFeatureSettings },
      setModelSetting: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
  },
}));

describe("ModelSelector", () => {
  it("renders agent type labels", () => {
    render(<ModelSelector level="global" />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders selects for all agent types", () => {
    render(<ModelSelector level="global" />);
    const combos = screen.getAllByRole("combobox");
    expect(combos.length).toBeGreaterThanOrEqual(7);
  });

  it("renders at project level without errors", () => {
    render(<ModelSelector level="project" projectId={1} />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("renders at feature level without errors", () => {
    render(<ModelSelector level="feature" featureId={1} projectId={1} />);
    expect(screen.getByText("Execute")).toBeInTheDocument();
  });
});
