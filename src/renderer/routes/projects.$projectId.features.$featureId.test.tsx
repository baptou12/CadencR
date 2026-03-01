import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockUseParams = vi.fn(() => ({ featureId: "1", projectId: "2" }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockGetByIdQuery = vi.fn(() => ({ data: undefined as any })) as any;
  return { mockUseParams, mockGetByIdQuery };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (opts: { component: unknown }) => ({
    options: opts,
    useSearch: vi.fn(() => ({})),
    useParams: mocks.mockUseParams,
  }),
  useNavigate: () => vi.fn(),
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

vi.mock("@/hooks/useContextUsage", () => ({
  useContextUsage: vi.fn(() => new Map()),
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

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      useUtils: vi.fn(() => ({
        features: {
          listByProject: { invalidate: vi.fn() },
          getById: { invalidate: vi.fn() },
          getProgress: { invalidate: vi.fn() },
        },
      })),
      features: {
        getById: { useQuery: mocks.mockGetByIdQuery },
      },
      workflow: {
        startSession: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isLoading: false })) },
      },
      agents: {
        sendMessage: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
        interrupt: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
        resume: { useMutation: vi.fn(() => ({ mutateAsync: vi.fn() })) },
      },
    },
  };
});

import { Route } from "./projects/$projectId/features/$featureId";

function FeaturePage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options?.component;
  if (!Component) return null;
  return <Component />;
}

describe("FeaturePage route", () => {
  beforeEach(() => {
    mocks.mockUseParams.mockReturnValue({ featureId: "1", projectId: "2" });
    mocks.mockGetByIdQuery.mockReturnValue({ data: undefined });
  });

  it("renders FeatureWorkflowView for regular feature", () => {
    mocks.mockGetByIdQuery.mockReturnValue({
      data: { id: 1, type: "feature", title: "My Feature" },
    });
    render(<FeaturePage />);
    expect(screen.getByTestId("feature-workflow-view")).toBeInTheDocument();
  });

  it("renders FeatureWorkflowView when feature data is loading (undefined)", () => {
    render(<FeaturePage />);
    expect(screen.getByTestId("feature-workflow-view")).toBeInTheDocument();
  });

  it("renders AgentSession for session-type feature", () => {
    mocks.mockGetByIdQuery.mockReturnValue({
      data: { id: 1, type: "session", title: "My Session" },
    });
    render(<FeaturePage />);
    expect(screen.getByTestId("agent-session")).toBeInTheDocument();
  });
});
