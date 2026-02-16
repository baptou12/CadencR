import { useState, useCallback, useRef, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SendIcon, MessageCircleQuestionIcon } from "lucide-react";

/** A single question from an AskUserQuestion tool call */
export interface AgentQuestion {
  /** The question text */
  question: string;
  /** Pre-defined options the user can choose from */
  options?: { label: string; description?: string }[];
  /** Whether multiple options can be selected */
  allowMultiple?: boolean;
}

interface AgentQuestionDrawerProps {
  /** The questions to display */
  questions: AgentQuestion[];
  /** Called when the user submits their response */
  onSubmit: (response: string) => void;
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
export function AgentQuestionDrawer({ questions, onSubmit, open, inline, disableShortcuts }: AgentQuestionDrawerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const currentQuestion = questions[currentIndex];

  const resetState = useCallback(() => {
    setSelectedOptions(new Set());
    setFreeText("");
    setShowOther(false);
  }, []);

  const handleOptionToggle = useCallback(
    (option: string) => {
      if (!currentQuestion) return;

      if (currentQuestion.allowMultiple) {
        setSelectedOptions((prev) => {
          const next = new Set(prev);
          if (next.has(option)) {
            next.delete(option);
          } else {
            next.add(option);
          }
          return next;
        });
      } else {
        // Single select — set only this option
        setSelectedOptions(new Set([option]));
        setShowOther(false);
        setFreeText("");
      }
    },
    [currentQuestion],
  );

  const handleOtherToggle = useCallback(() => {
    setShowOther((prev) => !prev);
    if (!showOther) {
      // If enabling "Other", deselect options in single-select mode
      if (!currentQuestion?.allowMultiple) {
        setSelectedOptions(new Set());
      }
    }
  }, [showOther, currentQuestion]);

  const getCurrentAnswer = useCallback((): string => {
    const parts: string[] = [];
    if (selectedOptions.size > 0) {
      parts.push(Array.from(selectedOptions).join(", "));
    }
    if (showOther && freeText.trim()) {
      parts.push(freeText.trim());
    }
    // If no options at all (free-text only question), use freeText directly
    if (!currentQuestion?.options?.length && freeText.trim()) {
      return freeText.trim();
    }
    return parts.join("; ");
  }, [selectedOptions, showOther, freeText, currentQuestion]);

  const handleNext = useCallback(() => {
    const answer = getCurrentAnswer();
    if (!answer) return;

    const newAnswers = [...answers, answer];

    if (currentIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setCurrentIndex((prev) => prev + 1);
      resetState();
    } else {
      // All questions answered — format and submit
      const response = questions
        .map((q, i) => `${q.question}\nAnswer: ${newAnswers[i]}`)
        .join("\n\n");
      onSubmit(response);

      // Reset everything
      setCurrentIndex(0);
      setAnswers([]);
      resetState();
    }
  }, [getCurrentAnswer, answers, currentIndex, questions, onSubmit, resetState]);

  const handleFreeTextSubmit = useCallback(() => {
    if (freeText.trim()) {
      handleNext();
    }
  }, [freeText, handleNext]);

  const flashHighlight = useCallback((index: number) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedIndex(index);
    highlightTimerRef.current = setTimeout(() => setHighlightedIndex(null), 300);
  }, []);

  // CMD+1 through CMD+9 to select/toggle option by index (last = "Other...")
  const otherShortcutIndex = currentQuestion?.options?.length ?? 0; // 0-based index for "Other"
  useHotkeys(
    "meta+1,meta+2,meta+3,meta+4,meta+5,meta+6,meta+7,meta+8,meta+9",
    (e) => {
      if (!open || !currentQuestion?.options) return;
      e.preventDefault();
      const digit = Number(e.key);
      // digit matching otherShortcutIndex + 1 toggles "Other..."
      if (digit === otherShortcutIndex + 1) {
        handleOtherToggle();
        flashHighlight(otherShortcutIndex);
        return;
      }
      if (digit < 1 || digit > currentQuestion.options.length) return;
      const option = currentQuestion.options[digit - 1];
      handleOptionToggle(option.label);
      flashHighlight(digit - 1);
    },
    { enabled: open && !disableShortcuts, enableOnFormTags: true },
    [open, disableShortcuts, currentQuestion, handleOptionToggle, handleOtherToggle, flashHighlight, otherShortcutIndex],
  );

  // Enter to validate/submit current question
  useHotkeys(
    "enter",
    (e) => {
      if (!open || !currentQuestion) return;
      // Don't intercept Enter when typing in the free text input (handled by onKeyDown there)
      if (showOther || !currentQuestion.options?.length) return;
      e.preventDefault();
      handleNext();
    },
    { enabled: open && !disableShortcuts },
    [open, disableShortcuts, currentQuestion, showOther, handleNext],
  );

  if (!open || !currentQuestion) {
    return null;
  }

  const hasAnswer =
    selectedOptions.size > 0 ||
    (showOther && freeText.trim().length > 0) ||
    (!currentQuestion.options?.length && freeText.trim().length > 0);

  const isLastQuestion = currentIndex >= questions.length - 1;
  const hasOptions = currentQuestion.options && currentQuestion.options.length > 0;

  return (
    <div className={cn(
      "bg-muted/20",
      inline ? "px-3 py-2" : "border-t border-border px-4 py-3"
    )}>
      {/* Progress indicator for multiple questions */}
      {questions.length > 1 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <MessageCircleQuestionIcon className="size-3" />
          <span>
            Question {currentIndex + 1} of {questions.length}
          </span>
        </div>
      )}

      {/* Question text */}
      <p className={cn("text-sm font-medium text-foreground", inline ? "mb-2" : "mb-3")}>{currentQuestion.question}</p>

      {/* Option list */}
      {hasOptions && (
        <div className="mb-2 flex flex-col gap-1.5">
          {currentQuestion.options!.map((option, optIdx) => (
            <button
              key={option.label}
              type="button"
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left transition-colors",
                selectedOptions.has(option.label)
                  ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                  : "border-border bg-background hover:bg-muted/50",
                highlightedIndex === optIdx && "ring-2 ring-blue-400 bg-blue-50/10 transition-none"
              )}
              onClick={() => handleOptionToggle(option.label)}
            >
              <span className="text-sm font-medium text-foreground">
                <kbd className="mr-1.5 inline-flex size-5 items-center justify-center rounded border border-border bg-muted text-[10px] text-foreground">{optIdx + 1}</kbd>
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
              )}
            </button>
          ))}
          {/* "Other" toggle */}
          <button
            type="button"
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left transition-colors",
              showOther
                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                : "border-border bg-background hover:bg-muted/50",
              highlightedIndex === currentQuestion.options!.length && "ring-2 ring-blue-400 bg-blue-50/10 transition-none"
            )}
            onClick={handleOtherToggle}
          >
            <span className="text-sm font-medium text-foreground">
              <kbd className="mr-1.5 inline-flex size-5 items-center justify-center rounded border border-border bg-muted text-[10px] text-foreground">{currentQuestion.options!.length + 1}</kbd>
              Other...
            </span>
          </button>
        </div>
      )}

      {/* Free text input (shown for "Other" or when no options) */}
      {(showOther || !hasOptions) && (
        <div className="mb-2 flex items-center gap-2">
          <Input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFreeTextSubmit();
            }}
            placeholder="Type your answer..."
            className={cn(
              "text-sm",
              inline && "h-8 border-border/50 bg-background shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
            )}
            autoFocus
          />
        </div>
      )}

      {/* Submit button */}
      <div className="flex justify-end">
        <Button size="sm" disabled={!hasAnswer} onClick={handleNext}>
          <SendIcon className="mr-1.5 size-3" />
          {isLastQuestion ? "Submit" : "Next"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Parse AskUserQuestion tool calls from stream-json events.
 * Extracts questions from content_block_start events with tool_use type
 * where the tool name is "AskUserQuestion".
 */
/** Normalize options array: handle both string[] and {label, description}[] formats */
function normalizeOptions(
  raw: unknown,
): { label: string; description?: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item: unknown) => {
    if (typeof item === "string") return { label: item };
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      return {
        label: (obj.label as string) ?? "",
        description:
          typeof obj.description === "string" ? obj.description : undefined,
      };
    }
    return { label: String(item) };
  });
}

export function parseAskUserQuestions(
  toolInput: Record<string, unknown>,
): AgentQuestion[] {
  // Handle single question format
  if (typeof toolInput.question === "string") {
    return [
      {
        question: toolInput.question as string,
        options: normalizeOptions(toolInput.options),
        allowMultiple: typeof toolInput.allowMultiple === "boolean"
          ? (toolInput.allowMultiple as boolean)
          : false,
      },
    ];
  }

  // Handle multiple questions format
  if (Array.isArray(toolInput.questions)) {
    return (toolInput.questions as Record<string, unknown>[]).map((q) => ({
      question: (q.question as string) ?? "",
      options: normalizeOptions(q.options),
      allowMultiple: typeof q.allowMultiple === "boolean"
        ? (q.allowMultiple as boolean)
        : false,
    }));
  }

  return [];
}
