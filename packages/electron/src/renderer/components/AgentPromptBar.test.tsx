import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentPromptBar } from "./AgentPromptBar";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

// Mock all tRPC-using hooks directly to avoid cascading mock complexity
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
      git: {
        listFiles: {
          useQuery: vi.fn(() => ({ data: undefined })),
        },
      },
    },
  };
});

describe("AgentPromptBar", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();

  beforeEach(() => {
    onSend.mockClear();
    onStop.mockClear();
  });

  it("renders textarea", () => {
    render(
      <AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows buttons when idle", () => {
    render(
      <AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows stop button when running", () => {
    render(
      <AgentPromptBar onSend={onSend} onStop={onStop} status="running" />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("calls onSend when text typed and Enter pressed", async () => {
    const user = userEvent.setup();
    render(
      <AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />,
    );
    await user.type(screen.getByRole("textbox"), "Hello agent{Enter}");
    expect(onSend).toHaveBeenCalledWith("Hello agent", undefined);
  });

  it("does not call onSend when text is empty and Enter pressed", async () => {
    const user = userEvent.setup();
    render(
      <AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />,
    );
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows question drawer when pending questions provided", () => {
    render(
      <AgentPromptBar
        onSend={onSend}
        onStop={onStop}
        status="paused"
        pendingQuestions={[{ question: "What do you need?" }]}
        onQuestionResponse={vi.fn()}
      />,
    );
    expect(screen.getByText(/What do you need/)).toBeInTheDocument();
  });

  it("renders with initialDraft text", () => {
    render(
      <AgentPromptBar
        onSend={onSend}
        onStop={onStop}
        status="idle"
        initialDraft="Draft text"
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("Draft text");
  });
});
