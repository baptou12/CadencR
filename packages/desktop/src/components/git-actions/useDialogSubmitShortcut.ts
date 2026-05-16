import { useEffect, useRef } from "react";

interface UseDialogSubmitShortcutOptions {
  open: boolean;
  enabled?: boolean;
  onSubmit: (event: KeyboardEvent) => void;
}

export function useDialogSubmitShortcut({
  open,
  enabled = true,
  onSubmit,
}: UseDialogSubmitShortcutOptions): void {
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (!open || !enabled) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (!isDialogSubmitShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onSubmitRef.current(event);
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, open]);
}

function isDialogSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}
