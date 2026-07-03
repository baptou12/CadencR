import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SendIcon } from "lucide-react";
import { AgentQuestionHeader } from "./agent-question/AgentQuestionHeader";
import { AgentQuestionOptionList } from "./agent-question/AgentQuestionOptionList";
import { useAgentQuestionForm } from "./agent-question/useAgentQuestionForm";
import { useAgentQuestionShortcuts } from "./agent-question/useAgentQuestionShortcuts";
import type { AgentQuestion, AgentQuestionAnswers } from "./agent-question/types";

export { parseAskUserQuestions } from "./agent-question/parse-questions";
export type { AgentQuestion, AgentQuestionAnswers } from "./agent-question/types";

interface AgentQuestionDrawerProps {
  /** The questions to display */
  questions: AgentQuestion[];
  /** Called when the user submits their response */
  onSubmit: (response: AgentQuestionAnswers) => void;
  /** Called when the user closes the gate without answering it */
  onCancel?: () => void;
  /** Whether the drawer is visible */
  open: boolean;
  /** When true, uses tighter spacing for inline rendering inside AgentPromptBar */
  inline?: boolean;
  /** When true, disables keyboard shortcuts (e.g. when multiple agents have questions) */
  disableShortcuts?: boolean;
}

/**
 * Bottom drawer that pushes content up, displaying dynamic forms
 * for AskUserQuestion tool calls from the Claude CLI.
 */
export function AgentQuestionDrawer({
  questions,
  onSubmit,
  onCancel,
  open,
  inline,
  disableShortcuts,
}: AgentQuestionDrawerProps) {
  const form = useAgentQuestionForm({ questions, onSubmit });

  useAgentQuestionShortcuts({
    open,
    disableShortcuts,
    onCancel,
    currentQuestion: form.currentQuestion,
    showOther: form.showOther,
    freeTextFocused: form.freeTextFocused,
    canGoBack: form.canGoBack,
    canGoForward: form.canGoForward,
    otherShortcutIndex: form.otherShortcutIndex,
    handleOptionToggle: form.handleOptionToggle,
    handleOtherToggle: form.handleOtherToggle,
    handleNext: form.handleNext,
    handleBack: form.handleBack,
    handleForward: form.handleForward,
    flashHighlight: form.flashHighlight,
  });

  if (!open || !form.currentQuestion) {
    return null;
  }
  const currentQuestion = form.currentQuestion;
  const { hasAnswer, isLastQuestion, hasOptions, selectedPreview } = form;

  return (
    <div
      className={cn(
        "agent-prompt-gate-panel bg-card",
        inline ? "px-3 py-2" : "border-t border-border px-4 py-3",
      )}
    >
      {/* Header row: progress indicator (multi-question) + dismiss X */}
      {(questions.length > 1 || onCancel) && (
        <AgentQuestionHeader
          questionsLength={questions.length}
          currentIndex={form.currentIndex}
          canGoBack={form.canGoBack}
          canGoForward={form.canGoForward}
          onBack={form.handleBack}
          onForward={form.handleForward}
          onCancel={onCancel}
        />
      )}

      {/* Question text */}
      <p className={cn("text-sm font-medium text-foreground", inline ? "mb-2" : "mb-3")}>
        {currentQuestion.question}
      </p>

      {/* Preview for selected option */}
      {selectedPreview && (
        <pre className="mb-2 overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-tight text-foreground">
          {selectedPreview}
        </pre>
      )}

      {/* Option list */}
      {hasOptions && (
        <AgentQuestionOptionList
          options={currentQuestion.options!}
          selectedOptions={form.selectedOptions}
          highlightedIndex={form.highlightedIndex}
          showOther={form.showOther}
          freeTextFocused={form.freeTextFocused}
          onOptionToggle={form.handleOptionToggle}
          onOtherToggle={form.handleOtherToggle}
        />
      )}

      {/* Free text input (shown for "Other" or when no options) */}
      {(form.showOther || !hasOptions) && (
        <div className="mb-2 flex items-center gap-2">
          <Input
            value={form.freeText}
            onChange={(e) => form.setFreeText(e.target.value)}
            onFocus={() => form.setFreeTextFocused(true)}
            onBlur={() => form.setFreeTextFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") form.handleFreeTextSubmit();
            }}
            placeholder="Type your answer..."
            className={cn(
              "text-sm",
              inline &&
                "h-8 border-border/50 bg-muted/40 shadow-none focus-visible:ring-1 focus-visible:ring-ring/40",
            )}
            autoFocus
          />
        </div>
      )}

      {/* Submit button */}
      <div className="flex justify-end">
        <Button size="sm" disabled={!hasAnswer} onClick={form.handleNext}>
          <SendIcon className="mr-1.5 size-3" />
          {isLastQuestion ? "Submit" : "Next"}
        </Button>
      </div>
    </div>
  );
}
