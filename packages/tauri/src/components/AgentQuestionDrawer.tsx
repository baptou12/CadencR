import { useState, useCallback, useRef, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KbdShortcut } from "@/components/KbdShortcut";
import { SendIcon, MessageCircleQuestionIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/** A single question from an AskUserQuestion tool call */
export interface AgentQuestion {
  /** The question text */
  question: string;
  /** Pre-defined options the user can choose from */
  options?: { label: string; description?: string; preview?: string }[];
  /** Whether multiple options can be selected */
  multiSelect?: boolean;
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
  const [answers, setAnswers] = useState<{ text: string; selectedOptions: Set<string>; freeText: string; showOther: boolean }[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [showOther, setShowOther] = useState(false);
  const freeTextFocusedRef = useRef(false);
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

  const getCurrentAnswerText = useCallback((): string => {
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

  /** Save current UI state into answers array at a given index */
  const saveCurrentState = useCallback((index: number) => {
    const text = getCurrentAnswerText();
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = { text, selectedOptions: new Set(selectedOptions), freeText, showOther };
      return next;
    });
  }, [getCurrentAnswerText, selectedOptions, freeText, showOther]);

  /** Restore UI state from a saved answer */
  const restoreState = useCallback((saved: { selectedOptions: Set<string>; freeText: string; showOther: boolean }) => {
    setSelectedOptions(new Set(saved.selectedOptions));
    setFreeText(saved.freeText);
    setShowOther(saved.showOther);
  }, []);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < answers.length - 1 && answers[currentIndex + 1] != null;

  const handleBack = useCallback(() => {
    if (!canGoBack) return;
    // Save current state before navigating
    saveCurrentState(currentIndex);
    const prevIndex = currentIndex - 1;
    setCurrentIndex(prevIndex);
    const saved = answers[prevIndex];
    if (saved) {
      restoreState(saved);
    } else {
      resetState();
    }
  }, [canGoBack, currentIndex, answers, saveCurrentState, restoreState, resetState]);

  const handleForward = useCallback(() => {
    if (!canGoForward) return;
    saveCurrentState(currentIndex);
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    const saved = answers[nextIndex];
    if (saved) {
      restoreState(saved);
    } else {
      resetState();
    }
  }, [canGoForward, currentIndex, answers, saveCurrentState, restoreState, resetState]);

  const handleOptionToggle = useCallback(
    (option: string) => {
      if (!currentQuestion) return;

      if (currentQuestion.multiSelect) {
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
      if (!currentQuestion?.multiSelect) {
        setSelectedOptions(new Set());
      }
    }
  }, [showOther, currentQuestion]);

  const handleNext = useCallback(() => {
    const answer = getCurrentAnswerText();
    if (!answer) return;

    // Save structured state at current index
    const newAnswers = [...answers];
    newAnswers[currentIndex] = { text: answer, selectedOptions: new Set(selectedOptions), freeText, showOther };

    if (currentIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setCurrentIndex((prev) => prev + 1);
      // Restore next answer if it exists (user went back then forward via Next)
      const nextSaved = newAnswers[currentIndex + 1];
      if (nextSaved) {
        setSelectedOptions(new Set(nextSaved.selectedOptions));
        setFreeText(nextSaved.freeText);
        setShowOther(nextSaved.showOther);
      } else {
        resetState();
      }
    } else {
      // All questions answered — format and submit
      const response = questions
        .map((q, i) => `${q.question}\nAnswer: ${newAnswers[i]?.text ?? ""}`)
        .join("\n\n");
      onSubmit(response);

      // Reset everything
      setCurrentIndex(0);
      setAnswers([]);
      resetState();
    }
  }, [getCurrentAnswerText, answers, currentIndex, questions, onSubmit, resetState, selectedOptions, freeText, showOther]);

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
    { enabled: open && !disableShortcuts, enableOnFormTags: true, enableOnContentEditable: true },
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

  // Left/Right arrow keys to navigate between questions
  useHotkeys(
    "left",
    (e) => {
      if (!open || freeTextFocusedRef.current) return;
      e.preventDefault();
      handleBack();
    },
    { enabled: open && !disableShortcuts && canGoBack },
    [open, disableShortcuts, canGoBack, handleBack],
  );

  useHotkeys(
    "right",
    (e) => {
      if (!open || freeTextFocusedRef.current) return;
      e.preventDefault();
      handleForward();
    },
    { enabled: open && !disableShortcuts && canGoForward },
    [open, disableShortcuts, canGoForward, handleForward],
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
  const selectedPreview = hasOptions
    ? currentQuestion.options!.filter((o) => selectedOptions.has(o.label) && o.preview).at(-1)?.preview
    : undefined;

  return (
    <div className={cn(
      "bg-[#181A25]",
      inline ? "px-3 py-2" : "border-t border-border px-4 py-3"
    )}>
      {/* Progress indicator with navigation arrows */}
      {questions.length > 1 && (
        <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={handleBack}
            className={cn(
              "inline-flex size-5 items-center justify-center rounded hover:bg-muted/50 transition-colors",
              canGoBack ? "text-foreground cursor-pointer" : "opacity-30 cursor-default"
            )}
            aria-label="Previous question"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <MessageCircleQuestionIcon className="size-3" />
          <span>
            Question {currentIndex + 1} of {questions.length}
          </span>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={handleForward}
            className={cn(
              "inline-flex size-5 items-center justify-center rounded hover:bg-muted/50 transition-colors",
              canGoForward ? "text-foreground cursor-pointer" : "opacity-30 cursor-default"
            )}
            aria-label="Next question"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Question text */}
      <p className={cn("text-sm font-medium text-foreground", inline ? "mb-2" : "mb-3")}>{currentQuestion.question}</p>

      {/* Preview for selected option */}
      {selectedPreview && (
        <pre className="mb-2 overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-tight text-foreground">
          {selectedPreview}
        </pre>
      )}

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
                  : "border-border bg-muted/40 hover:bg-muted/50",
                highlightedIndex === optIdx && "ring-2 ring-blue-400 bg-blue-50/10 transition-none"
              )}
              onClick={() => handleOptionToggle(option.label)}
            >
              <span className="text-sm font-medium text-foreground">
                <KbdShortcut keys={[String(optIdx + 1)]} variant="square" />
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
                : "border-border bg-muted/40 hover:bg-muted/50",
              highlightedIndex === currentQuestion.options!.length && "ring-2 ring-blue-400 bg-blue-50/10 transition-none"
            )}
            onClick={handleOtherToggle}
          >
            <span className="text-sm font-medium text-foreground">
              <KbdShortcut keys={[String(currentQuestion.options!.length + 1)]} variant="square" />
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
            onFocus={() => { freeTextFocusedRef.current = true; }}
            onBlur={() => { freeTextFocusedRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleFreeTextSubmit();
            }}
            placeholder="Type your answer..."
            className={cn(
              "text-sm",
              inline && "h-8 border-border/50 bg-muted/40 shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
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
): { label: string; description?: string; preview?: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item: unknown) => {
    if (typeof item === "string") return { label: item };
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      return {
        label: (obj.label as string) ?? "",
        description:
          typeof obj.description === "string" ? obj.description : undefined,
        preview:
          typeof obj.preview === "string" ? obj.preview : undefined,
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
        multiSelect: toolInput.multiSelect === true,
      },
    ];
  }

  // Handle multiple questions format
  if (Array.isArray(toolInput.questions)) {
    return (toolInput.questions as Record<string, unknown>[]).map((q) => ({
      question: (q.question as string) ?? "",
      options: normalizeOptions(q.options),
      multiSelect: q.multiSelect === true,
    }));
  }

  return [];
}
