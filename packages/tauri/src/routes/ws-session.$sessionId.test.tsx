import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockUseParams = vi.fn(() => ({ sessionId: "ws-feature-35" }));
  const mockUseSearch = vi.fn(() => ({ cwd: "/test/path", featureId: 35, projectId: 1 }));
  const mockActiveTab = vi.fn(() => ({ activeTab: "agent", setActiveTab: vi.fn() }));
  return { mockUseParams, mockUseSearch, mockActiveTab };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (opts: { component: unknown; validateSearch: unknown }) => ({
    options: opts,
    useSearch: mocks.mockUseSearch,
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
  FeatureTopBar: ({ featureId }: { featureId: number }) => (
    <div data-testid="feature-top-bar">FeatureTopBar {featureId}</div>
  ),
}));

vi.mock("@/components/FeatureTabBar", () => ({
  FeatureTabBar: ({
    activeTab,
    onTabChange,
  }: {
    activeTab: string;
    onTabChange: (tab: string) => void;
  }) => (
    <div data-testid="feature-tab-bar">
      <button onClick={() => onTabChange("agent")}>Agent</button>
      <button onClick={() => onTabChange("editor")}>Editor</button>
      <button onClick={() => onTabChange("terminal")}>Terminal</button>
      <button onClick={() => onTabChange("git")}>Git</button>
      <span data-testid="active-tab">{activeTab}</span>
    </div>
  ),
}));

vi.mock("@/components/FeatureTerminalTab", () => ({
  FeatureTerminalTab: ({ hidden }: { hidden: boolean }) => (
    <div data-testid="terminal-tab" className={hidden ? "hidden" : ""} />
  ),
}));

vi.mock("@/components/FeatureGitTab", () => ({
  FeatureGitTab: () => <div data-testid="git-tab" />,
}));

vi.mock("@/components/agent-session", () => ({
  AgentSession: vi.fn(() => <div data-testid="agent-session" />),
}));

vi.mock("@/components/editor/FeatureEditorTab", () => ({
  default: vi.fn(() => <div data-testid="editor-tab" />),
}));

vi.mock("@/components/diff/DiffViewerModal", () => ({
  DiffViewerModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="diff-modal" /> : null,
}));

vi.mock("@/hooks/useWebSocketSession", () => ({
  useWebSocketSession: vi.fn(() => ({
    blocks: [],
    status: "idle",
    isConnected: false,
    initSession: vi.fn(),
    sendPrompt: vi.fn(),
    interrupt: vi.fn(),
    clearSession: vi.fn(),
    pendingPermission: null,
    respondToPermission: vi.fn(),
    pendingQuestions: [],
    respondToQuestion: vi.fn(),
    permissionMode: "acceptEdits",
    setPermissionMode: vi.fn(),
    pendingPlanApproval: null,
    approvePlan: vi.fn(),
    requestPlanChanges: vi.fn(),
    contextUsage: null,
    currentModelId: null,
    setModel: vi.fn(),
    hasFileChanges: false,
    runtimeSessionId: null,
    hasMore: false,
    loadOlderMessages: vi.fn(),
  })),
}));

vi.mock("@/stores/ws-session-store", () => ({
  useWsSessionStore: vi.fn((selector) =>
    selector({
      sessions: {},
      requestSlashCommands: vi.fn(),
    }),
  ),
}));

vi.mock("@/hooks/useActiveTab", () => ({
  useActiveTab: mocks.mockActiveTab,
}));

vi.mock("@/hooks/useSaveLastOpenedFeature", () => ({
  useSaveLastOpenedFeature: vi.fn(),
}));

vi.mock("@/hooks/useResolvedModel", () => ({
  useResolvedModel: vi.fn(() => ({
    resolveProvider: vi.fn(() => "claude_code"),
    resolveModel: vi.fn(() => "claude-opus-4-5"),
    resolveModelThinkingEffort: vi.fn(() => undefined),
    setModelThinkingEffort: vi.fn(),
    handleProviderChange: vi.fn(),
    handleModelChange: vi.fn(),
  })),
}));

vi.mock("@/api/agentRuntime", () => ({
  useAgentCatalog: vi.fn(() => ({
    data: {
      default_provider: "claude_code",
      providers: [
        {
          id: "claude_code",
          label: "Claude Code",
          status: "available",
          models: [{ id: "claude-opus-4-5", label: "Opus" }],
          default_model: "claude-opus-4-5",
        },
      ],
    },
    isLoading: false,
  })),
}));

vi.mock("@/api/generated", () => ({
  useGetStats: vi.fn(() => ({ data: undefined })),
  useGetBranch: vi.fn(() => ({ data: undefined })),
  useGetFeatureSettings: vi.fn(() => ({ data: [] })),
  useListProjects: vi.fn(() => ({ data: [{ id: 1, name: "Test Project", path: "/test/path" }] })),
}));

import { Route } from "./ws-session.$sessionId";

function WsSessionPage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
    ?.component;
  if (!Component) return null;
  return <Component />;
}

describe("WsSessionPage route", () => {
  beforeEach(() => {
    mocks.mockUseParams.mockReturnValue({ sessionId: "ws-feature-35" });
    mocks.mockUseSearch.mockReturnValue({ cwd: "/test/path", featureId: 35, projectId: 1 });
    mocks.mockActiveTab.mockReturnValue({ activeTab: "agent", setActiveTab: vi.fn() });
  });

  it("renders the agent tab content by default", () => {
    render(<WsSessionPage />);
    expect(screen.getByTestId("agent-session")).toBeInTheDocument();
  });

  it("editor panel wrapper is visible when activeTab is editor", () => {
    mocks.mockActiveTab.mockReturnValue({ activeTab: "editor", setActiveTab: vi.fn() });
    const { container } = render(<WsSessionPage />);
    // The editor wrapper div should have h-full but NOT hidden
    const editorWrapper = container.querySelector(".h-full:not(.hidden)");
    expect(editorWrapper).toBeInTheDocument();
  });

  it("editor panel wrapper is hidden when activeTab is agent", () => {
    mocks.mockActiveTab.mockReturnValue({ activeTab: "agent", setActiveTab: vi.fn() });
    const { container } = render(<WsSessionPage />);
    // Agent div is visible (h-full), editor div should be h-full hidden
    const allHFull = container.querySelectorAll(".h-full");
    const editorWrapper = Array.from(allHFull).find(
      (el) =>
        el.className === "h-full hidden" && !el.querySelector("[data-testid='agent-session']"),
    );
    expect(editorWrapper).toBeTruthy();
  });

  it("renders git tab when activeTab is git", () => {
    mocks.mockActiveTab.mockReturnValue({ activeTab: "git", setActiveTab: vi.fn() });
    render(<WsSessionPage />);
    expect(screen.getByTestId("git-tab")).toBeInTheDocument();
  });

  it("does not render git tab when activeTab is not git", () => {
    render(<WsSessionPage />);
    expect(screen.queryByTestId("git-tab")).not.toBeInTheDocument();
  });
});
