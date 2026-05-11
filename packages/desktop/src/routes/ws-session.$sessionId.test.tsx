import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { act, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockUseParams = vi.fn(() => ({ sessionId: "ws-feature-35" }));
  const mockUseSearch = vi.fn(() => ({ cwd: "/test/path", featureId: 35, projectId: 1 }));
  const mockAgentVisible = vi.fn(() => true);
  const mockSplitEditorFocused = vi.fn(() => false);
  const mockFocusPromptBar = vi.fn();
  const mockFocusActiveInput = vi.fn();
  const mockSetFeatureSettingMutateAsync = vi.fn().mockResolvedValue(undefined);
  const mockSendPrompt = vi.fn();
  const mockToastError = vi.fn();
  const mockListBranches = vi.fn().mockResolvedValue([]);
  const mockCheckoutBranchMutateAsync = vi.fn().mockResolvedValue({ success: true });
  return {
    mockUseParams,
    mockUseSearch,
    mockAgentVisible,
    mockSplitEditorFocused,
    mockFocusPromptBar,
    mockFocusActiveInput,
    mockSetFeatureSettingMutateAsync,
    mockSendPrompt,
    mockToastError,
    mockListBranches,
    mockCheckoutBranchMutateAsync,
  };
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
  AgentSession: vi.fn((props: { ref?: unknown }) => {
    const React = require("react") as typeof import("react");
    React.useImperativeHandle(
      props.ref as React.Ref<{ focusPromptBar: () => void; focusActiveInput: () => void }>,
      () => ({
        focusPromptBar: mocks.mockFocusPromptBar,
        focusActiveInput: mocks.mockFocusActiveInput,
      }),
      [],
    );
    return <div data-testid="agent-session" />;
  }),
}));

vi.mock("@/components/editor/FeatureEditorTab", () => ({
  default: vi.fn(() => <div data-testid="editor-tab" />),
}));

vi.mock("@/components/diff/DiffViewerModal", () => ({
  DiffViewerModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="diff-modal" /> : null,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: mocks.mockToastError,
  },
}));

vi.mock("@/hooks/useWebSocketSession", () => ({
  useWebSocketSession: vi.fn(() => ({
    blocks: [],
    status: "idle",
    isConnected: false,
    initSession: vi.fn(),
    sendPrompt: mocks.mockSendPrompt,
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

vi.mock("@/stores/feature-layout-store", () => {
  interface MockLeaf {
    type: "leaf";
    id: string;
    tabIds: string[];
    activeTabId: string;
  }

  interface MockSplit {
    type: "split";
    children: [MockNode, MockNode];
  }

  type MockNode = MockLeaf | MockSplit;
  interface MockLayout {
    splitRoot: MockNode;
    focusedPaneId: string;
  }

  const findLeafById = (node: MockNode, id: string): MockLeaf | null => {
    if (node.type === "leaf") return node.id === id ? node : null;
    return findLeafById(node.children[0], id) ?? findLeafById(node.children[1], id);
  };
  const findPaneContaining = (node: MockNode, tab: string): MockLeaf | null => {
    if (node.type === "leaf") return node.tabIds.includes(tab) ? node : null;
    return findPaneContaining(node.children[0], tab) ?? findPaneContaining(node.children[1], tab);
  };
  const makeLayout = (): MockLayout =>
    mocks.mockSplitEditorFocused()
      ? {
          splitRoot: {
            type: "split",
            children: [
              { type: "leaf", id: "root", tabIds: ["agent"], activeTabId: "agent" },
              { type: "leaf", id: "editor-pane", tabIds: ["editor"], activeTabId: "editor" },
            ],
          },
          focusedPaneId: "editor-pane",
        }
      : {
          splitRoot: {
            type: "leaf",
            id: "root",
            tabIds: ["agent", "terminal", "git", "editor"],
            activeTabId: mocks.mockAgentVisible() ? "agent" : "editor",
          },
          focusedPaneId: "root",
        };

  return {
    useFeatureLayoutStore: vi.fn((selector) => {
      if (typeof selector === "function") {
        return selector({
          features: {
            35: { version: 1, ...makeLayout(), appliedLayoutId: null },
          },
          setPaneActiveTab: vi.fn(),
        });
      }
      return undefined;
    }),
    selectFeatureLayout: () => (s: { features: Record<number, unknown> }) => s.features[35],
    findLeafById,
    getFocusedTab: (state: MockLayout): string | null =>
      findLeafById(state.splitRoot, state.focusedPaneId)?.activeTabId ?? null,
    isTabVisible: (state: MockLayout, tab: string): boolean =>
      findPaneContaining(state.splitRoot, tab)?.activeTabId === tab,
  };
});

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

vi.mock("@/contexts/ResolvedModelContext", () => ({
  ResolvedModelProvider: ({ children }: { children: React.ReactNode }) => children,
  useResolvedModelContext: vi.fn(() => ({
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
          label: "Claude",
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
  useGetBranch: vi.fn(() => ({ data: undefined })),
  useGetFeatureSettings: vi.fn(() => ({ data: [] })),
  useGetGitStatus: vi.fn(() => ({ data: undefined })),
  useListProjects: vi.fn(() => ({ data: [{ id: 1, name: "Test Project", path: "/test/path" }] })),
  useGetWorkspaceSetting: vi.fn(() => ({ data: { value: "false" } })),
  useSetFeatureSetting: vi.fn(() => ({ mutateAsync: mocks.mockSetFeatureSettingMutateAsync })),
  useCheckoutBranch: vi.fn(() => ({ mutateAsync: mocks.mockCheckoutBranchMutateAsync })),
  useValidateCheckout: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ success: true }),
    isPending: false,
  })),
  getListBranchesQueryKey: vi.fn((params: { project_id: number }) => [
    "listBranches",
    params.project_id,
  ]),
  getGetBranchQueryKey: vi.fn((params: { project_id: number }) => ["getBranch", params.project_id]),
  getGetGitStatusQueryKey: vi.fn((params: { feature_id: number }) => [
    "getGitStatus",
    params.feature_id,
  ]),
  listBranches: mocks.mockListBranches,
  useListBranches: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
}));

vi.mock("@/hooks/useGitStatusSubscription", () => ({
  useGitStatusSubscription: vi.fn(),
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

async function selectBranchAndSend(branch: string): Promise<void> {
  render(<WsSessionPage />);
  await act(async () => {
    (lastAgentSessionProps().onWorktreeBranchChange as (branch: string | null) => void)(branch);
  });
  const onSend = lastAgentSessionProps().onSend as (text: string) => Promise<void>;
  await act(async () => {
    await onSend("hello");
  });
}

describe("WsSessionPage route", () => {
  beforeEach(() => {
    vi.mocked(AgentSession).mockClear();
    mocks.mockFocusPromptBar.mockClear();
    mocks.mockFocusActiveInput.mockClear();
    mocks.mockSendPrompt.mockClear();
    mocks.mockToastError.mockClear();
    mocks.mockListBranches.mockReset();
    mocks.mockListBranches.mockResolvedValue([]);
    mocks.mockSetFeatureSettingMutateAsync.mockReset();
    mocks.mockSetFeatureSettingMutateAsync.mockResolvedValue(undefined);
    mocks.mockUseParams.mockReturnValue({ sessionId: "ws-feature-35" });
    mocks.mockUseSearch.mockReturnValue({ cwd: "/test/path", featureId: 35, projectId: 1 });
    mocks.mockAgentVisible.mockReturnValue(true);
    mocks.mockSplitEditorFocused.mockReturnValue(false);
  });

  it("mounts every tab body via the layout shell", async () => {
    render(<WsSessionPage />);
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
    mocks.mockSplitEditorFocused.mockReturnValue(false);
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

  it("focuses the agent prompt on mount only when the agent tab owns focus", async () => {
    render(<WsSessionPage />);
    await waitFor(() => expect(mocks.mockFocusPromptBar).toHaveBeenCalled());
  });

  it("does not steal focus back to the agent prompt when the editor tab owns focus", async () => {
    mocks.mockSplitEditorFocused.mockReturnValue(true);
    render(<WsSessionPage />);
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mocks.mockFocusPromptBar).not.toHaveBeenCalled();
  });

  it("toasts and aborts the send when saving worktree settings fails (does not call sendPrompt)", async () => {
    mocks.mockSetFeatureSettingMutateAsync.mockRejectedValueOnce(new Error("disk full"));

    render(<WsSessionPage />);
    const props = lastAgentSessionProps();
    await act(async () => {
      (props.onToggleWorktree as () => void)();
    });
    const propsAfterToggle = lastAgentSessionProps();
    const onSend = propsAfterToggle.onSend as (text: string) => Promise<void>;
    await act(async () => {
      await expect(onSend("hello")).rejects.toThrow("disk full");
    });
    expect(mocks.mockToastError).toHaveBeenCalledTimes(1);
    expect(mocks.mockToastError.mock.calls[0][0]).toMatch(/worktree settings/i);
    expect(mocks.mockSendPrompt).not.toHaveBeenCalled();
  });

  it("reuses an attached selected branch on the first prompt even when the worktree toggle is off", async () => {
    mocks.mockListBranches.mockResolvedValue([
      {
        name: "feat/attached",
        is_local: true,
        attached_worktree_path: "/tmp/wt",
        attached_feature_id: 99,
      },
    ]);
    await selectBranchAndSend("feat/attached");
    expect(mocks.mockListBranches).toHaveBeenCalledTimes(1);
    expect(mocks.mockSetFeatureSettingMutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.mockSetFeatureSettingMutateAsync).toHaveBeenNthCalledWith(1, {
      id: 35,
      data: { key: "worktree_reuse_branch", value: "feat/attached" },
    });
    expect(mocks.mockSetFeatureSettingMutateAsync).toHaveBeenNthCalledWith(2, {
      id: 35,
      data: { key: "worktree_mode", value: "reuse" },
    });
    expect(mocks.mockSendPrompt).toHaveBeenCalledWith("hello", undefined, true);
  });

  it("does not persist worktree settings or start a worktree for an unattached selected branch when the toggle is off", async () => {
    mocks.mockListBranches.mockResolvedValue([
      {
        name: "feat/unattached",
        is_local: true,
        attached_worktree_path: null,
        attached_feature_id: null,
      },
    ]);
    await selectBranchAndSend("feat/unattached");
    expect(mocks.mockListBranches).toHaveBeenCalledTimes(1);
    expect(mocks.mockSetFeatureSettingMutateAsync).not.toHaveBeenCalled();
    expect(mocks.mockSendPrompt).toHaveBeenCalledWith("hello", undefined, undefined);
  });
});
