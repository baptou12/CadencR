import { useState, useCallback } from "react";
import { Send, Square } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import type { AgentStatus } from "@/components/AgentPanel";

export interface AgentPromptBarProps {
  onSend: (message: string) => void;
  onStop: () => void;
  status: AgentStatus;
  disabled?: boolean;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onQuestionResponse?: (response: string) => void;
}

export function AgentPromptBar({
  onSend,
  onStop,
  status,
  disabled,
  pendingQuestions,
  onQuestionResponse,
}: AgentPromptBarProps) {
  const [text, setText] = useState("");

  const isRunning = status === "running";
  const canSend = text.trim().length > 0 && !disabled;
  const hasQuestions = !!pendingQuestions && pendingQuestions.length > 0;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey && canSend) {
        e.preventDefault();
        handleSend();
      }
    },
    [canSend, handleSend],
  );

  // When questions are pending, render the question form inline instead of the prompt input
  if (hasQuestions && onQuestionResponse) {
    return (
      <AgentQuestionDrawer
        questions={pendingQuestions}
        open={true}
        onSubmit={onQuestionResponse}
      />
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message…"
        disabled={disabled}
        className="h-8 text-sm"
      />
      {isRunning ? (
        <Button
          variant="destructive"
          size="icon-xs"
          onClick={onStop}
          aria-label="Stop agent"
        >
          <Square />
        </Button>
      ) : (
        <Button
          variant="default"
          size="icon-xs"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
        >
          <Send />
        </Button>
      )}
    </div>
  );
}
