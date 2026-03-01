import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentSession } from "./AgentSession";
import type { AgentBlockData } from "./AgentBlock";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
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

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      workspace: {
        getAvailableModels: {
          useQuery: vi.fn(() => ({ data: [] })),
        },
      },
      git: {
        listFiles: {
          useQuery: vi.fn(() => ({ data: undefined })),
        },
      },
      features: {
        resolveWorkingDir: {
          useQuery: vi.fn(() => ({ data: undefined })),
        },
      },
      sessions: {
        getSupportedCommands: {
          useQuery: vi.fn(() => ({ data: undefined })),
        },
        getBackgroundTasks: {
          useQuery: vi.fn(() => ({ data: [] })),
        },
        killBackgroundTask: {
          useMutation: vi.fn(() => ({ mutate: vi.fn() })),
        },
      },
    },
  };
});

function makeBlock(id: string, content: string): AgentBlockData {
  return { id, type: "text", content };
}

describe("AgentSession", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();

  beforeEach(() => {
    onSend.mockClear();
    onStop.mockClear();
  });

  it("renders full-screen mode (collapsible=false)", () => {
    render(
      <AgentSession
        agentType="plan"
        blocks={[]}
        status="idle"
        onSend={onSend}
        onStop={onStop}
      />,
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
    expect(screen.getByText(/Send a message to start/)).toBeInTheDocument();
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
    expect(screen.getByText("Tasks")).toBeInTheDocument();
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
