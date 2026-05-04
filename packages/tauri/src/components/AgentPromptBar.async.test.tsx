/**
 * Async-onSend behavior for `AgentPromptBar`.
 *
 * Split out from `AgentPromptBar.test.tsx` to keep both files under the
 * 400-line cap. Covers the contract added so that callers (e.g.
 * ws-session.$sessionId, which awaits worktree-settings persistence
 * before sending the prompt) don't drop the user's text on failure:
 *
 *   - Rejected onSend → typed text restored, user can retry.
 *   - Resolved onSend → input cleared.
 *   - In-flight onSend → send button shows busy state and is disabled.
 *
 * Mock setup mirrors the sibling test file.
 */
import { forwardRef, useImperativeHandle, useRef, useState, type ForwardedRef } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";

const attachmentMocks = vi.hoisted(() => ({
  attachments: [] as Array<{
    id: string;
    fileName: string;
    base64: string;
    mimeType: string;
    previewUrl: string;
  }>,
  clearAttachments: vi.fn(),
  restoreAttachments: vi.fn(),
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
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
    attachments: attachmentMocks.attachments,
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: attachmentMocks.clearAttachments,
    restoreAttachments: attachmentMocks.restoreAttachments,
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

import { AgentPromptBar } from "./AgentPromptBar";

describe("AgentPromptBar async onSend", () => {
  const onStop = vi.fn();

  beforeEach(() => {
    attachmentMocks.attachments = [];
    attachmentMocks.clearAttachments.mockClear();
    attachmentMocks.restoreAttachments.mockClear();
  });

  it("restores the draft when async onSend rejects (so the user can retry)", async () => {
    const user = userEvent.setup();
    const failingOnSend = vi.fn().mockRejectedValue(new Error("save failed"));

    render(<AgentPromptBar onSend={failingOnSend} onStop={onStop} status="idle" />);

    await user.type(screen.getByRole("textbox"), "Need to retry");
    await user.click(screen.getByLabelText("Send message"));

    await screen.findByRole("textbox");
    expect(failingOnSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("Need to retry");
  });

  it("clears the draft when async onSend resolves successfully", async () => {
    const user = userEvent.setup();
    const okOnSend = vi.fn().mockResolvedValue(undefined);

    render(<AgentPromptBar onSend={okOnSend} onStop={onStop} status="idle" />);

    await user.type(screen.getByRole("textbox"), "Send me");
    await user.click(screen.getByLabelText("Send message"));

    await screen.findByRole("textbox");
    expect(okOnSend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("shows a busy/loading state on the send button while async onSend is in flight", async () => {
    const user = userEvent.setup();
    let resolveSend: () => void = () => {};
    const slowOnSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    render(<AgentPromptBar onSend={slowOnSend} onStop={onStop} status="idle" />);
    await user.type(screen.getByRole("textbox"), "queued");
    await user.click(screen.getByLabelText("Send message"));

    const btn = screen.getByLabelText("Send message");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();

    resolveSend();
    await screen.findByRole("textbox");
    expect(screen.getByLabelText("Send message")).toHaveAttribute("aria-busy", "false");
  });

  it("restores image attachments when async onSend rejects", async () => {
    const user = userEvent.setup();
    const image = {
      id: "img-1",
      fileName: "screen.png",
      base64: "abc123",
      mimeType: "image/png",
      previewUrl: "blob:test",
    };
    attachmentMocks.attachments = [image];
    const failingOnSend = vi.fn().mockRejectedValue(new Error("save failed"));

    render(<AgentPromptBar onSend={failingOnSend} onStop={onStop} status="idle" />);

    await user.click(screen.getByLabelText("Send message"));

    expect(failingOnSend).toHaveBeenCalledWith("", [{ base64: "abc123", mimeType: "image/png" }]);
    expect(attachmentMocks.clearAttachments).toHaveBeenCalledWith({
      revokeObjectUrls: false,
    });
    expect(attachmentMocks.restoreAttachments).toHaveBeenCalledWith([image]);
  });
});
