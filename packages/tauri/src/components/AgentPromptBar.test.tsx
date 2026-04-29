import { forwardRef, useImperativeHandle, useRef, useState, type ForwardedRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentPromptBar } from "./AgentPromptBar";

const hotkeyHandlers = new Map<string, (e: Partial<KeyboardEvent>) => void>();
vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn((key: string, handler: (e: Partial<KeyboardEvent>) => void) => {
    hotkeyHandlers.set(key, handler);
  }),
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

vi.mock("./prompt-editor/PromptEditor", () => {
  const MockPromptEditor = forwardRef(function MockPromptEditor(
    {
      initialText,
      onChange,
      placeholder,
      disabled,
    }: {
      initialText?: string;
      onChange?: (text: string) => void;
      placeholder?: string;
      disabled?: boolean;
    },
    ref: ForwardedRef<{
      focus: () => void;
      clear: () => void;
      setText: (text: string) => void;
      getText: () => string;
    }>,
  ) {
    const [value, setValue] = useState(initialText ?? "");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        clear: () => {
          setValue("");
          onChange?.("");
        },
        setText: (text: string) => {
          setValue(text);
          onChange?.(text);
        },
        getText: () => value,
      }),
      [onChange, value],
    );

    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event.target.value);
        }}
        placeholder={placeholder}
        disabled={disabled}
      />
    );
  });

  return { PromptEditor: MockPromptEditor };
});

describe("AgentPromptBar", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();

  beforeEach(() => {
    onSend.mockClear();
    onStop.mockClear();
    hotkeyHandlers.clear();
  });

  it("renders textarea", () => {
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows buttons when idle", () => {
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows stop button when running", () => {
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="running" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders send button that is disabled when empty", () => {
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    const sendButton = screen.getByLabelText("Send message");
    expect(sendButton).toBeDisabled();
  });

  it("focuses the input when clicking the gray prompt surface", () => {
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    const textbox = screen.getByRole("textbox");
    const surface = textbox.parentElement;
    expect(surface).toBeInstanceOf(HTMLElement);
    fireEvent.click(surface!);
    expect(document.activeElement).toBe(textbox);
  });

  it("does not focus the input when clicking prompt controls", () => {
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <AgentPromptBar onSend={onSend} onStop={onStop} status="running" />
      </div>,
    );
    const textbox = screen.getByRole("textbox");
    screen.getByTestId("outside").focus();
    fireEvent.click(screen.getByLabelText("Attach images"));
    expect(document.activeElement).not.toBe(textbox);
  });

  it("does not call onSend when text is empty and Enter pressed", async () => {
    const user = userEvent.setup();
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
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

  it("renders permission prompt when pendingPermission is provided", () => {
    render(
      <AgentPromptBar
        onSend={onSend}
        onStop={onStop}
        status="running"
        pendingPermission={{
          toolName: "Bash",
          input: { command: "ls /tmp" },
          description: "Run a bash command",
          pattern: "Bash(/tmp:*)",
          requestId: "req-1",
        }}
        onPermissionDecision={vi.fn()}
      />,
    );
    expect(screen.getByText(/Permission Required/)).toBeInTheDocument();
    expect(screen.getByText(/Allow once/)).toBeInTheDocument();
    // The regular prompt textarea should not be rendered
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders with initialDraft text", () => {
    render(
      <AgentPromptBar onSend={onSend} onStop={onStop} status="idle" initialDraft="Draft text" />,
    );
    expect(screen.getByRole("textbox")).toHaveTextContent("Draft text");
  });

  it("restores unsent text after a permission prompt closes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    await user.type(screen.getByRole("textbox"), "Keep this draft");

    rerender(
      <AgentPromptBar
        onSend={onSend}
        onStop={onStop}
        status="running"
        pendingPermission={{
          toolName: "Bash",
          input: { command: "ls /tmp" },
          description: "Run a bash command",
          pattern: "Bash(/tmp:*)",
          requestId: "req-1",
        }}
        onPermissionDecision={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    expect(screen.getByRole("textbox")).toHaveTextContent("Keep this draft");
  });

  it("restores unsent text after plan approval closes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    await user.type(screen.getByRole("textbox"), "Need a smaller plan");

    rerender(
      <AgentPromptBar
        onSend={onSend}
        onStop={onStop}
        status="paused"
        pendingPlanApproval={{ allowedPrompts: [] }}
        onPlanApprove={vi.fn()}
        onPlanRequestChanges={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    expect(screen.getByRole("textbox")).toHaveTextContent("Need a smaller plan");
  });

  it("restores unsent text after question drawer closes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    await user.type(screen.getByRole("textbox"), "Answer later");

    await act(async () => {
      rerender(
        <AgentPromptBar
          onSend={onSend}
          onStop={onStop}
          status="paused"
          pendingQuestions={[{ question: "What do you need?", options: [{ label: "Option A" }] }]}
          onQuestionResponse={vi.fn()}
        />,
      );
    });

    expect(await screen.findByText(/What do you need/i)).toBeInTheDocument();

    await act(async () => {
      rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    });

    expect(screen.getByRole("textbox")).toHaveTextContent("Answer later");
  });

  it("escape calls onStop when focus is inside the prompt bar", () => {
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="running" />);
    // Focus the textbox (inside the wrapper)
    screen.getByRole("textbox").focus();
    const handler = hotkeyHandlers.get("escape");
    expect(handler).toBeDefined();
    handler!({ preventDefault: vi.fn() });
    expect(onStop).toHaveBeenCalled();
  });

  it("escape does not call onStop when focus is outside the prompt bar", () => {
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <AgentPromptBar onSend={onSend} onStop={onStop} status="running" />
      </div>,
    );
    screen.getByTestId("outside").focus();
    const handler = hotkeyHandlers.get("escape");
    expect(handler).toBeDefined();
    handler!({ preventDefault: vi.fn() });
    expect(onStop).not.toHaveBeenCalled();
  });
});
