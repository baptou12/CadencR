import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockUseParams = vi.fn(() => ({ sessionId: "ws-feature-35" }));
  const mockUseSearch = vi.fn(() => ({ cwd: "/test/path", featureId: 35, projectId: 1 }));
  // Default: agent tab is the visible/active root tab.
  const mockAgentVisible = vi.fn(() => true);
  return { mockUseParams, mockUseSearch, mockAgentVisible };
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

vi.mock("@/components/feature-layout/FeatureLayoutShell", () => ({
  // Render every tab's content in a flat container so the test can assert
  // each tab's body without driving DnD/portal infrastructure.
  FeatureLayoutShell: ({ tabs }: { tabs: Record<string, { content: React.ReactNode }> }) => (
    <div data-testid="feature-layout-shell">
      <div data-testid="agent-pane">{tabs.agent.content}</div>
      <div data-testid="terminal-pane">{tabs.terminal.content}</div>
      <div data-testid="git-pane">{tabs.git.content}</div>
      <div data-testid="editor-pane">{tabs.editor.content}</div>
    </div>
  ),
}));

vi.mock("@/components/FeatureTerminalTab", () => ({
  FeatureTerminalTab: () => <div data-testid="terminal-tab" />,
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

vi.mock("@/stores/feature-layout-store", () => ({
  useFeatureLayoutStore: vi.fn((selector) => {
    if (typeof selector === "function") {
      return selector({
        features: {
          35: {
            version: 1,
            splitRoot: {
              type: "leaf",
              id: "root",
              tabIds: ["agent", "terminal", "git", "editor"],
              activeTabId: mocks.mockAgentVisible() ? "agent" : "editor",
            },
            focusedPaneId: "root",
            appliedLayoutId: null,
          },
        },
        setPaneActiveTab: vi.fn(),
      });
    }
    return undefined;
  }),
  selectFeatureLayout: () => (s: { features: Record<number, unknown> }) => s.features[35],
  findLeafById: (root: { type: string; id?: string; activeTabId?: string }) =>
    root.type === "leaf" ? root : null,
  isTabVisible: (state: { splitRoot: { activeTabId: string } }, tab: string): boolean =>
    state.splitRoot.activeTabId === tab,
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
import { AgentSession } from "@/components/agent-session";
import { useWsSessionStore } from "@/stores/ws-session-store";

function WsSessionPage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
    ?.component;
  if (!Component) return null;
  return <Component />;
}

function lastAgentSessionProps(): Record<string, unknown> {
  const calls = vi.mocked(AgentSession).mock.calls;
  return calls[calls.length - 1]?.[0] as unknown as Record<string, unknown>;
}

describe("WsSessionPage route", () => {
  beforeEach(() => {
    vi.mocked(AgentSession).mockClear();
    mocks.mockUseParams.mockReturnValue({ sessionId: "ws-feature-35" });
    mocks.mockUseSearch.mockReturnValue({ cwd: "/test/path", featureId: 35, projectId: 1 });
    mocks.mockAgentVisible.mockReturnValue(true);
  });

  it("mounts every tab body via the layout shell", async () => {
    render(<WsSessionPage />);
    // All tabs are always mounted now — visibility is handled by the
    // (mocked-out) layout shell. Editor is lazy-loaded so we await it.
    expect(screen.getByTestId("agent-session")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-tab")).toBeInTheDocument();
    expect(screen.getByTestId("git-tab")).toBeInTheDocument();
    expect(await screen.findByTestId("editor-tab")).toBeInTheDocument();
  });

  it("forwards session todos to AgentSession when the agent tab is visible", () => {
    const todos = [{ content: "do x", status: "pending" as const, activeForm: "doing x" }];
    vi.mocked(useWsSessionStore).mockImplementation((selector) =>
      (selector as (s: unknown) => unknown)({
        sessions: { "ws-feature-35": { todos } },
        requestSlashCommands: vi.fn(),
        retryWorktreeSetup: vi.fn(),
      }),
    );
    mocks.mockAgentVisible.mockReturnValue(true);
    render(<WsSessionPage />);
    expect(lastAgentSessionProps().todos).toEqual(todos);
  });

  it("passes null todos to AgentSession when the agent tab is hidden", () => {
    const todos = [{ content: "do x", status: "pending" as const, activeForm: "doing x" }];
    vi.mocked(useWsSessionStore).mockImplementation((selector) =>
      (selector as (s: unknown) => unknown)({
        sessions: { "ws-feature-35": { todos } },
        requestSlashCommands: vi.fn(),
        retryWorktreeSetup: vi.fn(),
      }),
    );
    mocks.mockAgentVisible.mockReturnValue(false);
    render(<WsSessionPage />);
    expect(lastAgentSessionProps().todos).toBeNull();
  });
});
