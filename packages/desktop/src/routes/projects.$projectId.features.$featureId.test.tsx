import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockUseParams = vi.fn(() => ({ featureId: "1", projectId: "2" }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockGetByIdQuery = vi.fn(() => ({ data: undefined as any })) as any;
  const mockSaveLastOpened = vi.fn();
  return { mockUseParams, mockGetByIdQuery, mockSaveLastOpened };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (opts: { component: unknown }) => ({
    options: opts,
    useSearch: vi.fn(() => ({})),
    useParams: mocks.mockUseParams,
  }),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
  useRouterState: () => ({ location: { pathname: "/" } }),
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));

vi.mock("@/components/FeatureTopBar", () => ({
  FeatureTopBar: ({ featureId }: { featureId: string }) => (
    <div data-testid="feature-top-bar">FeatureTopBar {featureId}</div>
  ),
}));

vi.mock("@/components/AgentSession", () => ({
  AgentSession: vi.fn(({ agentType }: { agentType: string }) => (
    <div data-testid="agent-session">{agentType}</div>
  )),
}));

vi.mock("@/components/FeatureWorkflowView", () => ({
  FeatureWorkflowView: ({ featureId }: { featureId: number }) => (
    <div data-testid="feature-workflow-view">FeatureWorkflowView {featureId}</div>
  ),
}));

vi.mock("@/components/diff/DiffViewerModal", () => ({
  DiffViewerModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="diff-modal" /> : null,
}));

vi.mock("@/components/terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock("@/hooks/useFeatureAgentState", () => ({
  useFeatureAgentState: vi.fn(() => ({ sessions: [], refetch: vi.fn() })),
}));

vi.mock("@/hooks/useResolvedModel", () => ({
  useResolvedModel: vi.fn(() => ({
    resolveModel: vi.fn(() => "claude-opus-4-5"),
    handleModelChange: vi.fn(),
  })),
}));

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: vi.fn(() => ({ value: "300", setValue: vi.fn() })),
}));

vi.mock("@/hooks/useTerminalState", () => ({
  useTerminalState: vi.fn(() => ({
    isOpen: false,
    isMinimized: false,
    panes: [],
    togglePanel: vi.fn(),
    addPane: vi.fn(),
    removePane: vi.fn(),
    minimize: vi.fn(),
  })),
  useTerminalStore: vi.fn((selector) =>
    selector({ sendToTerminal: vi.fn(), clearInitialCommand: vi.fn() }),
  ),
}));

vi.mock("@/hooks/useAgentChat", () => ({
  useAgentChat: vi.fn(() => ({
    handleAnswerSubmit: vi.fn(),
    handlePlanApprove: vi.fn(),
    handlePlanRequestChanges: vi.fn(),
    handlePermissionDecision: vi.fn(),
  })),
  usePermissionMode: vi.fn(() => ({
    permissionMode: "acceptEdits",
    handlePermissionModeToggle: vi.fn(),
    setPermissionMode: vi.fn(),
  })),
}));

vi.mock("@/api/generated", () => ({
  useGetFeature: mocks.mockGetByIdQuery,
  useListProjects: () => ({ data: [{ id: 2, name: "Test", path: "/test" }] }),
}));

vi.mock("@/hooks/useSaveLastOpenedFeature", () => ({
  useSaveLastOpenedFeature: mocks.mockSaveLastOpened,
}));

import { Route } from "./projects/$projectId/features/$featureId";

function FeaturePage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
    ?.component;
  if (!Component) return null;
  return <Component />;
}

describe("FeaturePage route", () => {
  beforeEach(() => {
    mocks.mockUseParams.mockReturnValue({ featureId: "1", projectId: "2" });
    mocks.mockGetByIdQuery.mockReturnValue({ data: undefined });
    mocks.mockSaveLastOpened.mockClear();
  });

  it("renders FeatureWorkflowView for ws-feature", () => {
    mocks.mockGetByIdQuery.mockReturnValue({
      data: { id: 1, type: "ws-feature", title: "My Feature" },
    });
    render(<FeaturePage />);
    expect(screen.getByTestId("feature-workflow-view")).toBeInTheDocument();
  });

  it("renders FeatureWorkflowView when feature data is loading (undefined)", () => {
    render(<FeaturePage />);
    expect(screen.getByTestId("feature-workflow-view")).toBeInTheDocument();
  });

  it("does not call useSaveLastOpenedFeature from route (handled by child views)", () => {
    mocks.mockUseParams.mockReturnValue({ featureId: "7", projectId: "3" });
    render(<FeaturePage />);
    expect(mocks.mockSaveLastOpened).not.toHaveBeenCalled();
  });

  it("renders a not-found state when the feature query 404s", () => {
    // The backend now returns 404 (not 200-null) for missing features. Mounting
    // FeatureWorkflowView with `feature=undefined` after a *confirmed* missing
    // response would silently produce a half-broken UI keyed on a phantom id.
    // `axios.isAxiosError` requires the `isAxiosError: true` brand to recognise
    // the rejection — mirror that here so the route's narrowing path runs.
    const error = Object.assign(new Error("not found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    mocks.mockGetByIdQuery.mockReturnValue({
      data: undefined,
      isError: true,
      error,
      refetch: vi.fn(),
    });
    render(<FeaturePage />);
    expect(screen.queryByTestId("feature-workflow-view")).not.toBeInTheDocument();
    expect(screen.getByText("Feature #1 not found")).toBeInTheDocument();
  });

  it("renders a generic error state with a retry for non-404 failures", () => {
    const refetch = vi.fn();
    mocks.mockGetByIdQuery.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error("network down"),
      refetch,
    });
    render(<FeaturePage />);
    expect(screen.queryByTestId("feature-workflow-view")).not.toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(refetch).toHaveBeenCalled();
  });
});
