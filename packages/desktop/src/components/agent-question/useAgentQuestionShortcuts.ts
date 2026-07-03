import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { useScopedShortcut } from "@/hooks/useShortcut";
import type { AgentQuestion } from "./types";

interface UseAgentQuestionShortcutsParams {
  open: boolean;
  disableShortcuts?: boolean;
  currentQuestion: AgentQuestion | undefined;
  showOther: boolean;
  freeTextFocused: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 0-based index for the "Other" highlight */
  otherShortcutIndex: number;
  handleOptionToggle: (option: string) => void;
  handleOtherToggle: () => void;
  handleNext: () => void;
  handleBack: () => void;
  handleForward: () => void;
  flashHighlight: (index: number) => void;
  onCancel?: () => void;
}

/**
 * Registers the keyboard shortcuts for the agent question drawer:
 * 1-9 to select an option, Mod+O to toggle "Other", Enter to submit,
 * Left/Right to navigate between questions, and Escape to cancel.
 */
export function useAgentQuestionShortcuts({
  open,
  disableShortcuts,
  currentQuestion,
  showOther,
  freeTextFocused,
  canGoBack,
  canGoForward,
  otherShortcutIndex,
  handleOptionToggle,
  handleOtherToggle,
  handleNext,
  handleBack,
  handleForward,
  flashHighlight,
  onCancel,
}: UseAgentQuestionShortcutsParams): void {
  // `useScopedShortcut` enables form tags by default, so pressing "1" while
  // typing in the "Other" free-text input would otherwise select an option
  // instead of inserting the digit. Opt out explicitly so numbers are typed
  // into the input — same as q-submit/q-prev/q-next below.
  useScopedShortcut(
    "q-select-1-9",
    (e) => {
      if (!open || !currentQuestion?.options) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const digit = Number(e.key);
      if (digit > currentQuestion.options.length) return;
      e.preventDefault();
      const option = currentQuestion.options[digit - 1];
      handleOptionToggle(option.label);
      flashHighlight(digit - 1);
    },
    "agent",
    {
      enabled: open && !disableShortcuts,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [open, disableShortcuts, currentQuestion, handleOptionToggle, flashHighlight],
  );

  useScopedShortcut(
    "q-other",
    (e) => {
      if (!open || !currentQuestion?.options) return;
      e.preventDefault();
      handleOtherToggle();
      flashHighlight(otherShortcutIndex);
    },
    "agent",
    { enabled: open && !disableShortcuts },
    [
      open,
      disableShortcuts,
      currentQuestion,
      handleOtherToggle,
      flashHighlight,
      otherShortcutIndex,
    ],
  );

  // Enter to validate/submit current question. Default enableOnFormTags=true
  // would steal Enter inside the free-text input; opt out explicitly.
  useScopedShortcut(
    "q-submit",
    (e) => {
      if (!open || !currentQuestion) return;
      if (showOther || !currentQuestion.options?.length) return;
      e.preventDefault();
      handleNext();
    },
    "agent",
    {
      enabled: open && !disableShortcuts,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [open, disableShortcuts, currentQuestion, showOther, handleNext],
  );

  // Left/Right arrow keys to navigate between questions
  useScopedShortcut(
    "q-prev",
    (e) => {
      if (!open || freeTextFocused) return;
      e.preventDefault();
      handleBack();
    },
    "agent",
    {
      enabled: open && !disableShortcuts && canGoBack,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [open, disableShortcuts, canGoBack, handleBack, freeTextFocused],
  );

  useScopedShortcut(
    "q-next",
    (e) => {
      if (!open || freeTextFocused) return;
      e.preventDefault();
      handleForward();
    },
    "agent",
    {
      enabled: open && !disableShortcuts && canGoForward,
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [open, disableShortcuts, canGoForward, handleForward, freeTextFocused],
  );

  useScopedHotkeys(
    "escape",
    (event) => {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
    },
    "agent",
    {
      enabled: open && !!onCancel && !disableShortcuts,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [open, onCancel, disableShortcuts],
  );
}
