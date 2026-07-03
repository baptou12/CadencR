import { useState, useCallback, useRef, useEffect } from "react";
import type { AgentQuestion, AgentQuestionAnswers } from "./types";

interface UseAgentQuestionFormParams {
  questions: AgentQuestion[];
  onSubmit: (response: AgentQuestionAnswers) => void;
}

export interface AgentQuestionForm {
  currentIndex: number;
  currentQuestion: AgentQuestion | undefined;
  selectedOptions: Set<string>;
  freeText: string;
  setFreeText: (value: string) => void;
  showOther: boolean;
  freeTextFocused: boolean;
  setFreeTextFocused: (value: boolean) => void;
  highlightedIndex: number | null;
  canGoBack: boolean;
  canGoForward: boolean;
  otherShortcutIndex: number;
  handleBack: () => void;
  handleForward: () => void;
  handleOptionToggle: (option: string) => void;
  handleOtherToggle: () => void;
  handleNext: () => void;
  handleFreeTextSubmit: () => void;
  flashHighlight: (index: number) => void;
  hasAnswer: boolean;
  isLastQuestion: boolean;
  hasOptions: boolean;
  selectedPreview: string | undefined;
}

/**
 * Holds all of the state and handlers for the agent question drawer:
 * option selection, "Other" free-text, per-question answer persistence,
 * and forward/back navigation across a multi-question set.
 */
export function useAgentQuestionForm({
  questions,
  onSubmit,
}: UseAgentQuestionFormParams): AgentQuestionForm {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<
    { text: string; selectedOptions: Set<string>; freeText: string; showOther: boolean }[]
  >([]);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [showOther, setShowOther] = useState(false);
  // Drives re-render so the digit badges dim while the free-text input is
  // focused — mirroring that the 1-9 selectors don't fire inside inputs.
  const [freeTextFocused, setFreeTextFocused] = useState(false);
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
    // Submitting via Enter (or any path that unmounts the input) never fires
    // its onBlur, so clear the focus flag here — otherwise the 1-9 badges stay
    // dimmed on the next question even though "Other" isn't selected.
    setFreeTextFocused(false);
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

  const getAnswerValues = useCallback(
    (
      question: AgentQuestion | undefined,
      answerState: { selectedOptions: Set<string>; freeText: string; showOther: boolean },
    ): string[] => {
      if (!question) return [];
      const values: string[] = [];
      if (question.options?.length) {
        values.push(...Array.from(answerState.selectedOptions));
        if (answerState.showOther && answerState.freeText.trim()) {
          values.push(answerState.freeText.trim());
        }
        return values;
      }
      if (answerState.freeText.trim()) {
        return [answerState.freeText.trim()];
      }
      return values;
    },
    [],
  );

  /** Save current UI state into answers array at a given index */
  const saveCurrentState = useCallback(
    (index: number) => {
      const text = getCurrentAnswerText();
      setAnswers((prev) => {
        const next = [...prev];
        next[index] = { text, selectedOptions: new Set(selectedOptions), freeText, showOther };
        return next;
      });
    },
    [getCurrentAnswerText, selectedOptions, freeText, showOther],
  );

  /** Restore UI state from a saved answer */
  const restoreState = useCallback(
    (saved: { selectedOptions: Set<string>; freeText: string; showOther: boolean }) => {
      setSelectedOptions(new Set(saved.selectedOptions));
      setFreeText(saved.freeText);
      setShowOther(saved.showOther);
    },
    [],
  );

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
    newAnswers[currentIndex] = {
      text: answer,
      selectedOptions: new Set(selectedOptions),
      freeText,
      showOther,
    };

    if (currentIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setCurrentIndex((prev) => prev + 1);
      // Restore next answer if it exists (user went back then forward via Next)
      const nextSaved = newAnswers[currentIndex + 1];
      if (nextSaved) {
        setSelectedOptions(new Set(nextSaved.selectedOptions));
        setFreeText(nextSaved.freeText);
        setShowOther(nextSaved.showOther);
        // The restored input isn't focused; clear the flag so 1-9 stay active.
        setFreeTextFocused(false);
      } else {
        resetState();
      }
    } else {
      const response = questions.map((question, index) =>
        getAnswerValues(
          question,
          newAnswers[index] ?? {
            text: "",
            selectedOptions: new Set<string>(),
            freeText: "",
            showOther: false,
          },
        ),
      );
      onSubmit(response);

      // Reset everything
      setCurrentIndex(0);
      setAnswers([]);
      resetState();
    }
  }, [
    getCurrentAnswerText,
    answers,
    currentIndex,
    questions,
    onSubmit,
    resetState,
    selectedOptions,
    freeText,
    showOther,
    getAnswerValues,
  ]);

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

  // 1 through 9 selects/toggles an option by index. Mod+O toggles "Other..."
  const otherShortcutIndex = currentQuestion?.options?.length ?? 0; // 0-based index for "Other" highlight

  const hasAnswer =
    selectedOptions.size > 0 ||
    (showOther && freeText.trim().length > 0) ||
    (!currentQuestion?.options?.length && freeText.trim().length > 0);

  const isLastQuestion = currentIndex >= questions.length - 1;
  const hasOptions = !!(currentQuestion?.options && currentQuestion.options.length > 0);
  const selectedPreview = hasOptions
    ? currentQuestion!.options!.filter((o) => selectedOptions.has(o.label) && o.preview).at(-1)
        ?.preview
    : undefined;

  return {
    currentIndex,
    currentQuestion,
    selectedOptions,
    freeText,
    setFreeText,
    showOther,
    freeTextFocused,
    setFreeTextFocused,
    highlightedIndex,
    canGoBack,
    canGoForward,
    otherShortcutIndex,
    handleBack,
    handleForward,
    handleOptionToggle,
    handleOtherToggle,
    handleNext,
    handleFreeTextSubmit,
    flashHighlight,
    hasAnswer,
    isLastQuestion,
    hasOptions,
    selectedPreview,
  };
}
