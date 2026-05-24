/**
 * Conversation-isolation tests for `AgentPromptBar`. Regression for the bug
 * where leftover text from one conversation visibly remained after /clear or
 * a feature switch. Split from `AgentPromptBar.test.tsx` to stay under the
 * 400-line file cap.
 */
import { forwardRef, useImperativeHandle, useRef, useState, type ForwardedRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";

vi.mock("@tanstack/react-hotkeys", () => ({ useHotkeys: vi.fn() }));

const usePromptDraftMock = vi.fn(() => ({
  saveDraft: vi.fn(),
  initialDraft: null as string | null,
  dbSessionId: null as number | null,
}));
vi.mock("@/hooks/usePromptDraft", () => ({
  usePromptDraft: (...args: unknown[]) => usePromptDraftMock(...(args as [])),
}));

vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: vi.fn(() => ({ addEntry: vi.fn(), history: [], resetNavigation: vi.fn() })),
}));

vi.mock("@/hooks/useImageAttachments", () => ({
  useImageAttachments: vi.fn(() => ({
    attachments: [],
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    restoreAttachments: vi.fn(),
    dragHandlers: {},
    isDragging: false,
  })),
}));

vi.mock("./prompt-editor/PromptEditor", () => {
  const MockPromptEditor = forwardRef(function MockPromptEditor(
    { initialText, onChange }: { initialText?: string; onChange?: (text: string) => void },
    ref: ForwardedRef<{ setText: (text: string) => void }>,
  ) {
    const [value, setValue] = useState(initialText ?? "");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        setText: (text: string) => {
          setValue(text);
          onChange?.(text);
        },
        // Unused by these tests but required by the PromptEditorHandle type.
        focus: () => textareaRef.current?.focus(),
        clear: () => setValue(""),
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
      />
    );
  });
  return { PromptEditor: MockPromptEditor };
});

import { AgentPromptBar } from "./AgentPromptBar";

describe("AgentPromptBar conversation isolation", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();

  beforeEach(() => {
    onSend.mockClear();
    onStop.mockClear();
    usePromptDraftMock.mockReturnValue({
      saveDraft: vi.fn(),
      initialDraft: null,
      dbSessionId: null,
    });
  });

  it("clears the editor when the DB session id changes (e.g. /clear, feature switch)", () => {
    usePromptDraftMock.mockReturnValue({ saveDraft: vi.fn(), initialDraft: null, dbSessionId: 10 });
    const { rerender } = render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "leftover from conv 10" } });

    usePromptDraftMock.mockReturnValue({ saveDraft: vi.fn(), initialDraft: null, dbSessionId: 11 });
    rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("loads the new conversation's draft after the async fetch resolves", () => {
    usePromptDraftMock.mockReturnValue({ saveDraft: vi.fn(), initialDraft: null, dbSessionId: 10 });
    const { rerender } = render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed in conv 10" } });

    usePromptDraftMock.mockReturnValue({ saveDraft: vi.fn(), initialDraft: null, dbSessionId: 11 });
    rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    expect(screen.getByRole("textbox")).toHaveValue("");

    usePromptDraftMock.mockReturnValue({
      saveDraft: vi.fn(),
      initialDraft: "fresh draft for 11",
      dbSessionId: 11,
    });
    rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    expect(screen.getByRole("textbox")).toHaveValue("fresh draft for 11");
  });

  it("does not clear on first mount when dbSessionId starts concrete", () => {
    usePromptDraftMock.mockReturnValue({
      saveDraft: vi.fn(),
      initialDraft: "restored from server",
      dbSessionId: 10,
    });
    render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    expect(screen.getByRole("textbox")).toHaveValue("restored from server");
  });

  it("preserves in-flight typing across the null → concrete init transition", () => {
    usePromptDraftMock.mockReturnValue({
      saveDraft: vi.fn(),
      initialDraft: null,
      dbSessionId: null,
    });
    const { rerender } = render(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed before init" } });

    usePromptDraftMock.mockReturnValue({ saveDraft: vi.fn(), initialDraft: null, dbSessionId: 42 });
    rerender(<AgentPromptBar onSend={onSend} onStop={onStop} status="idle" />);

    expect(screen.getByRole("textbox")).toHaveValue("typed before init");
  });
});
