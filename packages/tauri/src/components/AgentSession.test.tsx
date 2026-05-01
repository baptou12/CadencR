import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentSession, shallowEqualSkipFunctions } from "./agent-session";
import type { AgentSessionProps } from "./agent-session";
import type { AgentBlockData } from "./AgentBlock";

// Mock Virtuoso so JSDOM tests render all items synchronously instead of
// relying on layout/IntersectionObserver. We don't need true virtualization
// here — the assertions check that block content is reachable in the DOM.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
    components,
  }: {
    data?: AgentBlockData[];
    itemContent?: (index: number, block: AgentBlockData) => ReactNode;
    components?: { Header?: () => ReactNode; Footer?: () => ReactNode };
  }) => (
    <div data-testid="virtuoso-mock">
      {components?.Header ? <components.Header /> : null}
      {data?.map((item, i) => (
        <div key={item.id}>{itemContent?.(i, item)}</div>
      ))}
      {components?.Footer ? <components.Footer /> : null}
    </div>
  ),
}));

const hotkeyHandlers = new Map<string, (event: KeyboardEvent) => void>();

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn((keys: string, handler: (event: KeyboardEvent) => void) => {
    hotkeyHandlers.set(keys, handler);
  }),
}));

vi.mock("../api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/generated")>()),
  useGetFeatureWorkingDir: vi.fn(() => ({ data: null })),
  useGetWorkspaceSetting: vi.fn(() => ({ data: { value: null } })),
}));

vi.mock("../api/agentRuntime", () => ({
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
        {
          id: "opencode",
          label: "OpenCode",
          status: "available",
          models: [],
          default_model: null,
        },
      ],
    },
    isLoading: false,
  })),
}));

// Mock hooks to avoid cascading tRPC dependencies
vi.mock("@/hooks/useBackgroundTasks", () => ({
  useBackgroundTasks: vi.fn(() => ({ tasks: [], activeCount: 0 })),
}));

vi.mock("@/hooks/usePromptDraft", () => ({
  usePromptDraft: vi.fn(() => ({ saveDraft: vi.fn() })),
}));

vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: vi.fn(() => ({
    addEntry: vi.fn(),
    history: [],
    navigateUp: vi.fn(),
    navigateDown: vi.fn(),
    reset: vi.fn(),
    resetNavigation: vi.fn(),
  })),
}));

vi.mock("@/hooks/useFileMention", () => ({
  useFileMention: vi.fn(() => ({
    open: false,
    query: "",
    filteredFiles: [],
    selectedIndex: 0,
    handleKeyDown: vi.fn(),
    handleChange: vi.fn(),
    selectFile: vi.fn(),
    triggerMention: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("@/hooks/useSlashCommand", () => ({
  useSlashCommand: vi.fn(() => ({
    open: false,
    query: "",
    filteredCommands: [],
    selectedIndex: 0,
    handleKeyDown: vi.fn(),
    handleChange: vi.fn(),
    selectCommand: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("@/hooks/useImageAttachments", () => ({
  useImageAttachments: vi.fn(() => ({
    attachments: [],
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    dragHandlers: {},
    isDragging: false,
  })),
}));

function makeBlock(id: string, content: string): AgentBlockData {
  return { id, type: "text", content };
}

describe("AgentSession", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();

  beforeEach(async () => {
    const runtimeApi = await import("../api/agentRuntime");
    onSend.mockClear();
    onStop.mockClear();
    hotkeyHandlers.clear();
    vi.mocked(runtimeApi.useAgentCatalog).mockReturnValue({
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
          {
            id: "opencode",
            label: "OpenCode",
            status: "available",
            models: [],
            default_model: null,
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof runtimeApi.useAgentCatalog>);
  });

  it("renders full-screen mode (collapsible=false)", () => {
    render(
      <AgentSession agentType="plan" blocks={[]} status="idle" onSend={onSend} onStop={onStop} />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows empty state when idle with no blocks", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
      />,
    );
    expect(screen.getByText("Send a message to start a session.")).toBeInTheDocument();
  });

  it("shows cross-provider models before a session starts without standalone provider actions", async () => {
    const runtimeApi = await import("../api/agentRuntime");
    const catalog = {
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
          {
            id: "opencode",
            label: "OpenCode",
            status: "available",
            models: [{ id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
            default_model: "openai/gpt-5.3-codex",
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof runtimeApi.useAgentCatalog>;
    vi.mocked(runtimeApi.useAgentCatalog).mockReturnValue(catalog);

    const user = userEvent.setup();
    render(
      <AgentSession
        agentType="session"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        currentProviderId="claude_code"
        currentModelId="opus"
        runtimeProvider="claude_code"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Opus/i }));

    const optionTexts = screen.getAllByRole("option").map((element) => element.textContent ?? "");
    expect(optionTexts.some((text) => text.includes("Claude Code / Opus"))).toBe(true);
    expect(optionTexts.some((text) => text.includes("OpenCode / GPT-5.3 Codex"))).toBe(true);
    expect(screen.queryByText(/Use Claude Code/)).toBeNull();
    expect(screen.queryByText(/Use OpenCode/)).toBeNull();
  });

  it("opens the searchable model picker with Cmd+P", async () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        currentProviderId="claude_code"
        currentModelId="opus"
        runtimeProvider="claude_code"
      />,
    );

    await act(async () => {
      hotkeyHandlers.get("meta+p")?.({ preventDefault: vi.fn() } as unknown as KeyboardEvent);
    });

    const searchInput = await screen.findByPlaceholderText("Search providers or models...");
    expect(searchInput).toBeInTheDocument();
    await waitFor(() => expect(searchInput).toHaveFocus());
  });

  it("locks the provider list once a session has history", async () => {
    const runtimeApi = await import("../api/agentRuntime");
    vi.mocked(runtimeApi.useAgentCatalog).mockReturnValueOnce({
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
          {
            id: "opencode",
            label: "OpenCode",
            status: "available",
            models: [{ id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
            default_model: "openai/gpt-5.3-codex",
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof runtimeApi.useAgentCatalog>);

    const user = userEvent.setup();
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "hello")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        currentProviderId="claude_code"
        currentModelId="opus"
        runtimeProvider="claude_code"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Opus/i }));

    expect(screen.queryByText("OpenCode")).toBeNull();
    expect(screen.queryByText(/Use Claude Code/)).toBeNull();
    expect(screen.queryByText(/Use OpenCode/)).toBeNull();
  });

  it("renders blocks content", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[makeBlock("1", "Agent output text")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
      />,
    );
    expect(screen.getByText("Agent output text")).toBeInTheDocument();
  });

  it("renders collapsible mode with header", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        collapsible
      />,
    );
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("shows status badge - running", () => {
    render(
      <AgentSession
        agentType="execute"
        blocks={[]}
        status="running"
        onSend={onSend}
        onStop={onStop}
        collapsible
      />,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows completed badge", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[makeBlock("1", "done")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        collapsible
      />,
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows error badge", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[]}
        status="error"
        onSend={onSend}
        onStop={onStop}
        collapsible
      />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("uses custom label when provided", () => {
    render(
      <AgentSession
        agentType="execute"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        collapsible
        label="Execute 2"
      />,
    );
    expect(screen.getByText("Execute 2")).toBeInTheDocument();
  });

  it("shows Resume button when resumable", () => {
    const onResume = vi.fn();
    render(
      <AgentSession
        agentType="plan"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        collapsible
        resumable
        onResume={onResume}
      />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("calls onResume when Resume clicked", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(
      <AgentSession
        agentType="plan"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        collapsible
        resumable
        onResume={onResume}
      />,
    );
    await user.click(screen.getByRole("button", { name: /resume/i }));
    expect(onResume).toHaveBeenCalled();
  });

  it("shows diff bar when hasFileChanges and onViewDiff provided", () => {
    render(
      <AgentSession
        agentType="execute"
        blocks={[]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        hasFileChanges
        onViewDiff={vi.fn()}
      />,
    );
    expect(screen.getByText(/Review Changes/)).toBeInTheDocument();
  });

  it("shows todo list when todos provided", () => {
    render(
      <AgentSession
        agentType="execute"
        blocks={[]}
        status="running"
        onSend={onSend}
        onStop={onStop}
        todos={[{ content: "Do the thing", activeForm: "Doing the thing", status: "in_progress" }]}
      />,
    );
    expect(screen.getByText("0/1")).toBeInTheDocument();
  });

  it("does not open provider-only actions when a provider has no models", async () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        currentProviderId="claude_code"
        currentModelId="opus"
        runtimeProvider="claude_code"
      />,
    );

    await act(async () => {
      hotkeyHandlers.get("meta+p")?.({ preventDefault: vi.fn() } as unknown as KeyboardEvent);
    });

    expect(
      screen.getByText((_, element) => element?.textContent === "OpenCode"),
    ).toBeInTheDocument();
    expect(screen.getByText("No models available")).toBeInTheDocument();
  });

  it("uses model provider icon when persisted provider is stale after restart", async () => {
    const runtimeApi = await import("../api/agentRuntime");
    vi.mocked(runtimeApi.useAgentCatalog).mockReturnValueOnce({
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
          {
            id: "opencode",
            label: "OpenCode",
            status: "available",
            models: [{ id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
            default_model: "openai/gpt-5.3-codex",
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof runtimeApi.useAgentCatalog>);

    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "hello")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        onProviderChange={vi.fn()}
        onModelChange={vi.fn()}
        currentProviderId="claude_code"
        currentModelId="openai/gpt-5.3-codex"
        runtimeProvider="opencode"
      />,
    );

    const modelIcon = screen.getByAltText("GPT-5.3 Codex");
    expect(modelIcon).toHaveAttribute("src", expect.stringContaining("opencode"));
  });

  it("shows prompt bar for completed plan agent when pendingPlanApproval is set", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[makeBlock("1", "Plan output")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        collapsible
        pendingPlanApproval={{ allowedPrompts: [] }}
        onPlanApprove={vi.fn()}
        onPlanRequestChanges={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("shows prompt bar for completed prd agent when pendingPlanApproval is set", () => {
    render(
      <AgentSession
        agentType="prd"
        blocks={[makeBlock("1", "PRD output")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        collapsible
        pendingPlanApproval={{ allowedPrompts: [] }}
        onPlanApprove={vi.fn()}
        onPlanRequestChanges={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("hides prompt bar for completed plan agent when NO pendingPlanApproval", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[makeBlock("1", "Plan output")]}
        status="completed"
        onSend={onSend}
        onStop={onStop}
        collapsible
      />,
    );
    expect(screen.queryByText("Plan ready for review")).toBeNull();
  });

  it("shows prompt bar when agent is paused with pendingPlanApproval", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[makeBlock("1", "Plan output")]}
        status="paused"
        onSend={onSend}
        onStop={onStop}
        collapsible
        pendingPlanApproval={{ allowedPrompts: [] }}
        onPlanApprove={vi.fn()}
        onPlanRequestChanges={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });
});

describe("shallowEqualSkipFunctions", () => {
  const base: Partial<AgentSessionProps> = {
    agentType: "execute",
    status: "running",
    blocks: [],
    collapsible: true,
    featureId: 1,
    onSend: vi.fn(),
    onStop: vi.fn(),
  };

  it("returns true when data props are identical and functions differ", () => {
    const prev = { ...base, onSend: vi.fn(), onStop: vi.fn() } as AgentSessionProps;
    const next = { ...base, onSend: vi.fn(), onStop: vi.fn() } as AgentSessionProps;
    expect(shallowEqualSkipFunctions(prev, next)).toBe(true);
  });

  it("returns false when a data prop changes", () => {
    const prev = { ...base } as AgentSessionProps;
    const next = { ...base, status: "completed" as const } as AgentSessionProps;
    expect(shallowEqualSkipFunctions(prev, next)).toBe(false);
  });

  it("returns false when blocks reference changes", () => {
    const prev = { ...base, blocks: [] } as AgentSessionProps;
    const next = { ...base, blocks: [] } as AgentSessionProps;
    expect(shallowEqualSkipFunctions(prev, next)).toBe(false);
  });

  it("returns true when blocks reference is the same", () => {
    const blocks: AgentBlockData[] = [];
    const prev = { ...base, blocks } as AgentSessionProps;
    const next = { ...base, blocks } as AgentSessionProps;
    expect(shallowEqualSkipFunctions(prev, next)).toBe(true);
  });

  it("returns false when a data prop is removed", () => {
    const prev = { ...base, featureId: 1 } as AgentSessionProps;
    const next = { ...base } as AgentSessionProps;
    delete (next as unknown as Record<string, unknown>).featureId;
    expect(shallowEqualSkipFunctions(prev, next)).toBe(false);
  });
});
