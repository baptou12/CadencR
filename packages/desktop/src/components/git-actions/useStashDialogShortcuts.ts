import { useCallback, useMemo, type RefObject } from "react";

import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { useDialogSubmitShortcut } from "./useDialogSubmitShortcut";

interface StashDialogShortcutOptions {
  canSubmit: boolean;
  enabled: boolean;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onConfirm: () => Promise<void>;
  onToggle: () => void;
}

/** Dialog-local bindings; intentionally separate from Phase 3 global shortcuts. */
export function useStashDialogShortcuts({
  canSubmit,
  enabled,
  nameInputRef,
  onConfirm,
  onToggle,
}: StashDialogShortcutOptions): void {
  const mnemonicOptions = useMemo(
    () => ({ enabled, preventDefault: true, stopPropagation: true }),
    [enabled],
  );
  const focusNameInput = useCallback((): void => {
    nameInputRef.current?.focus();
  }, [nameInputRef]);
  // Bare letter mnemonics ignore form fields, preserving normal name input.
  useAppHotkeys("n", focusNameInput, mnemonicOptions, [focusNameInput]);
  useAppHotkeys("u", onToggle, mnemonicOptions, [onToggle]);
  useDialogSubmitShortcut({
    open: enabled,
    enabled: canSubmit,
    onSubmit: () => void onConfirm(),
  });
}
