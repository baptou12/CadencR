import { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { Send, Square } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import type { AgentStatus } from "@/components/AgentSession";

export interface AgentPromptBarProps {
  onSend: (message: string) => void;
  onStop: () => void;
  status: AgentStatus;
  disabled?: boolean;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onQuestionResponse?: (response: string) => void;
  /** When true, disables keyboard shortcuts in the question drawer */
  disableShortcuts?: boolean;
  /** Called when the textarea gains or loses focus */
  onFocusChange?: (focused: boolean) => void;
}

/** Handle exposed by AgentPromptBar via forwardRef */
export interface AgentPromptBarHandle {
  /** Focus the textarea input */
  focusInput: () => void;
}

export const AgentPromptBar = forwardRef<AgentPromptBarHandle, AgentPromptBarProps>(function AgentPromptBar({
  onSend,
  onStop,
  status,
  disabled,
  pendingQuestions,
  onQuestionResponse,
  disableShortcuts,
  onFocusChange,
}, ref) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      textareaRef.current?.focus({ focusVisible: true } as FocusOptions);
    },
  }));

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const canSend = text.trim().length > 0 && !disabled;
  const hasQuestions = !!pendingQuestions && pendingQuestions.length > 0;

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && isRunning) {
        e.preventDefault();
        onStop();
      } else if (e.key === "Enter" && !e.shiftKey && canSend) {
        e.preventDefault();
        handleSend();
      } else if (e.key === "Enter" && !e.shiftKey && !canSend) {
        e.preventDefault();
      }
    },
    [canSend, handleSend, isRunning, onStop],
  );

  // When questions are pending, render the question form inline instead of the prompt input
  if (hasQuestions && onQuestionResponse) {
    return (
      <AgentQuestionDrawer
        questions={pendingQuestions}
        open={true}
        onSubmit={onQuestionResponse}
        inline
        disableShortcuts={disableShortcuts}
      />
    );
  }

  return (
    <div className="flex items-center gap-2 bg-muted/20 px-3 py-2">
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        placeholder={isPaused ? "Send a message to resume…" : "Send a message…"}
        disabled={disabled}
        rows={1}
        className="max-h-32 min-h-[42px] resize-none overflow-hidden border-border/50 bg-background py-2.5 text-sm leading-[22px] shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
      />
      {isRunning ? (
        <Button
          variant="destructive"
          size="icon"
          onClick={onStop}
          aria-label="Stop agent"
          className="h-[42px] w-[42px] shrink-0"
        >
          <Square className="size-3.5" />
        </Button>
      ) : (
        <Button
          variant="default"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className="h-[42px] w-[42px] shrink-0"
        >
          <Send className="size-3.5" />
        </Button>
      )}
    </div>
  );
});
