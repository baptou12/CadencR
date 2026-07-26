import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { agentQuestionOptionValue, type AgentQuestion, type AgentQuestionAnswers } from "./types";

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

interface SavedAnswer {
  text: string;
  selectedOptions: Set<string>;
  freeText: string;
  showOther: boolean;
}

const EMPTY_ANSWER = (): SavedAnswer => ({
  text: "",
  selectedOptions: new Set<string>(),
  freeText: "",
  showOther: false,
});

function answerText(question: AgentQuestion | undefined, state: SavedAnswer): string {
  if (!question?.options?.length) return state.freeText.trim();
  const parts = Array.from(state.selectedOptions);
  if (state.showOther && state.freeText.trim()) parts.push(state.freeText.trim());
  return parts.join("; ");
}

function answerValues(question: AgentQuestion | undefined, state: SavedAnswer): string[] {
  if (!question) return [];
  if (!question.options?.length) return state.freeText.trim() ? [state.freeText.trim()] : [];
  const values = Array.from(state.selectedOptions);
  if (state.showOther && state.freeText.trim()) values.push(state.freeText.trim());
  return values;
}

function useQuestionFormState() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [freeTextFocused, setFreeTextFocused] = useState(false);
  const resetState = useCallback(() => {
    setSelectedOptions(new Set());
    setFreeText("");
    setShowOther(false);
    setFreeTextFocused(false);
  }, []);
  const restoreState = useCallback((saved: SavedAnswer) => {
    setSelectedOptions(new Set(saved.selectedOptions));
    setFreeText(saved.freeText);
    setShowOther(saved.showOther);
    setFreeTextFocused(false);
  }, []);
  return useMemo(
    () => ({
      answers,
      currentIndex,
      freeText,
      freeTextFocused,
      resetState,
      restoreState,
      selectedOptions,
      setAnswers,
      setCurrentIndex,
      setFreeText,
      setFreeTextFocused,
      setSelectedOptions,
      setShowOther,
      showOther,
    }),
    [
      answers,
      currentIndex,
      freeText,
      freeTextFocused,
      resetState,
      restoreState,
      selectedOptions,
      showOther,
    ],
  );
}

type QuestionFormState = ReturnType<typeof useQuestionFormState>;

function currentSavedAnswer(
  question: AgentQuestion | undefined,
  state: QuestionFormState,
): SavedAnswer {
  const snapshot = {
    text: "",
    selectedOptions: new Set(state.selectedOptions),
    freeText: state.freeText,
    showOther: state.showOther,
  };
  return { ...snapshot, text: answerText(question, snapshot) };
}

function useQuestionNavigation(questions: AgentQuestion[], state: QuestionFormState) {
  const canGoBack = state.currentIndex > 0;
  const canGoForward =
    state.currentIndex < state.answers.length - 1 && state.answers[state.currentIndex + 1] != null;
  const saveCurrentState = useCallback(() => {
    const saved = currentSavedAnswer(questions[state.currentIndex], state);
    state.setAnswers((previous) => {
      const next = [...previous];
      next[state.currentIndex] = saved;
      return next;
    });
  }, [questions, state]);
  const move = useCallback(
    (nextIndex: number): void => {
      saveCurrentState();
      state.setCurrentIndex(nextIndex);
      const saved = state.answers[nextIndex];
      if (saved) state.restoreState(saved);
      else state.resetState();
    },
    [saveCurrentState, state],
  );
  const handleBack = useCallback(() => {
    if (canGoBack) move(state.currentIndex - 1);
  }, [canGoBack, move, state.currentIndex]);
  const handleForward = useCallback(() => {
    if (canGoForward) move(state.currentIndex + 1);
  }, [canGoForward, move, state.currentIndex]);
  return useMemo(
    () => ({ canGoBack, canGoForward, handleBack, handleForward }),
    [canGoBack, canGoForward, handleBack, handleForward],
  );
}

function useQuestionSubmission(
  questions: AgentQuestion[],
  onSubmit: (response: AgentQuestionAnswers) => void,
  state: QuestionFormState,
) {
  const handleNext = useCallback(() => {
    const current = currentSavedAnswer(questions[state.currentIndex], state);
    if (!current.text) return;
    const newAnswers = [...state.answers];
    newAnswers[state.currentIndex] = current;
    if (state.currentIndex < questions.length - 1) {
      state.setAnswers(newAnswers);
      state.setCurrentIndex((previous) => previous + 1);
      const nextSaved = newAnswers[state.currentIndex + 1];
      if (nextSaved) state.restoreState(nextSaved);
      else state.resetState();
      return;
    }
    onSubmit(
      questions.map((question, index) =>
        answerValues(question, newAnswers[index] ?? EMPTY_ANSWER()),
      ),
    );
    state.setCurrentIndex(0);
    state.setAnswers([]);
    state.resetState();
  }, [onSubmit, questions, state]);
  const handleFreeTextSubmit = useCallback(() => {
    if (state.freeText.trim()) handleNext();
  }, [handleNext, state.freeText]);
  return useMemo(() => ({ handleFreeTextSubmit, handleNext }), [handleFreeTextSubmit, handleNext]);
}

function useQuestionOptions(question: AgentQuestion | undefined, state: QuestionFormState) {
  const handleOptionToggle = useCallback(
    (option: string) => {
      if (!question) return;
      if (question.multiSelect) {
        state.setSelectedOptions((previous) => {
          const next = new Set(previous);
          if (next.has(option)) next.delete(option);
          else next.add(option);
          return next;
        });
      } else {
        state.setSelectedOptions(new Set([option]));
        state.setShowOther(false);
        state.setFreeText("");
      }
    },
    [question, state],
  );
  const handleOtherToggle = useCallback(() => {
    state.setShowOther((previous) => !previous);
    if (!state.showOther && !question?.multiSelect) state.setSelectedOptions(new Set());
  }, [question?.multiSelect, state]);
  return useMemo(
    () => ({ handleOptionToggle, handleOtherToggle }),
    [handleOptionToggle, handleOtherToggle],
  );
}

function useQuestionHighlight() {
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const flashHighlight = useCallback((index: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHighlightedIndex(index);
    timerRef.current = setTimeout(() => setHighlightedIndex(null), 300);
  }, []);
  return useMemo(() => ({ flashHighlight, highlightedIndex }), [flashHighlight, highlightedIndex]);
}

export function useAgentQuestionForm({
  questions,
  onSubmit,
}: UseAgentQuestionFormParams): AgentQuestionForm {
  const state = useQuestionFormState();
  const currentQuestion = questions[state.currentIndex];
  const navigation = useQuestionNavigation(questions, state);
  const submission = useQuestionSubmission(questions, onSubmit, state);
  const options = useQuestionOptions(currentQuestion, state);
  const highlight = useQuestionHighlight();
  const hasOptions = !!currentQuestion?.options?.length;
  const hasAnswer =
    state.selectedOptions.size > 0 ||
    (state.showOther && state.freeText.trim().length > 0) ||
    (!hasOptions && state.freeText.trim().length > 0);
  const selectedPreview = hasOptions
    ? currentQuestion.options
        ?.filter(
          (option) => state.selectedOptions.has(agentQuestionOptionValue(option)) && option.preview,
        )
        .at(-1)?.preview
    : undefined;
  return {
    currentIndex: state.currentIndex,
    currentQuestion,
    selectedOptions: state.selectedOptions,
    freeText: state.freeText,
    setFreeText: state.setFreeText,
    showOther: state.showOther,
    freeTextFocused: state.freeTextFocused,
    setFreeTextFocused: state.setFreeTextFocused,
    highlightedIndex: highlight.highlightedIndex,
    ...navigation,
    otherShortcutIndex: currentQuestion?.options?.length ?? 0,
    ...options,
    ...submission,
    flashHighlight: highlight.flashHighlight,
    hasAnswer,
    isLastQuestion: state.currentIndex >= questions.length - 1,
    hasOptions,
    selectedPreview,
  };
}
