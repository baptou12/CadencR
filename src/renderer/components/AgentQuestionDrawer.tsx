import { useState, useCallback } from "react";
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
}

/**
 * Bottom drawer that pushes content up, displaying dynamic forms
 * for AskUserQuestion tool calls from the Claude CLI.
 */
export function AgentQuestionDrawer({ questions, onSubmit, open, inline }: AgentQuestionDrawerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [showOther, setShowOther] = useState(false);

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

      {/* Option buttons */}
      {hasOptions && (
        <div className="mb-2 flex flex-wrap gap-2">
          {currentQuestion.options!.map((option) => (
            <Button
              key={option.label}
              variant={selectedOptions.has(option.label) ? "default" : "outline"}
              size="sm"
              className={cn("text-xs", selectedOptions.has(option.label) && "ring-2 ring-primary/30")}
              onClick={() => handleOptionToggle(option.label)}
            >
              {option.label}
            </Button>
          ))}
          {/* "Other" toggle */}
          <Button
            variant={showOther ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={handleOtherToggle}
          >
            Other...
          </Button>
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
